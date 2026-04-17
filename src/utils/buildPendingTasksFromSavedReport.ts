/**
 * @fileoverview 日报保存后生成「待安排任务」：计划提取（需公司/他部协助事项）与 AI 建议（正文暴露问题但文末计划未覆盖）。
 *
 * 规则为轻量 JSON + 原文扫描的启发式实现，便于离线运行；后续可替换为二次 LLM 调用。
 */

import type {
  ExtractionHistoryItem,
  PendingAiSuggestionTaskRow,
  PendingDailyPlanTaskRow,
} from "../types/extractionHistory";
import {
  branchRootFromOrgPath,
  GROUP_LEADER_PERSPECTIVE,
  isBranchCompanyUnit,
  orgUnitFromPerspective,
} from "./leaderPerspective";
import { pickBranchCompany, pickExtractionDate } from "./extractionHistoryGroup";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getProductionReportRoot(parsed: unknown): Record<string, unknown> | null {
  if (!isRecord(parsed)) return null;
  const pr = parsed["production_report"];
  return isRecord(pr) ? pr : null;
}

/** 在原文中取可稳定命中的跳转 needle（尽量用较长子串） */
function pickJumpNeedle(originalText: string, hint: string): string {
  const h = hint.trim();
  if (!h) return originalText.slice(0, 12);
  for (let n = Math.min(72, h.length); n >= 8; n--) {
    const sub = h.slice(0, n);
    if (originalText.includes(sub)) return sub;
  }
  return originalText.includes("生产经营分析日报")
    ? "生产经营分析日报"
    : originalText.slice(0, Math.min(12, originalText.length));
}

/** 协调类句子里若充斥抽取/schema 话术，则不作为「需协助」任务展示 */
function isPromptLikeCoordinationLine(s: string): boolean {
  return /统一\s*JSON|多车间块|键名|模板|模型|穿透看板|附录表格较多.*JSON|合并「[^」]+」.*JSON/i.test(s);
}

function splitCoordinationSentences(blob: string): string[] {
  const parts = blob
    .split(/[。\n]+/)
    .map((x) => x.trim().replace(/^协调事项[：:]\s*/, "").replace(/^技术攻坚[：:]\s*/, ""))
    .filter((x) => x.length >= 10);
  const out: string[] = [];
  for (const p of parts) {
    if (/协助|申请|请|对接|重估|选型|报件|供货|协调|保障|联系|报备|加急/.test(p)) out.push(p);
  }
  return out;
}

const TRIVIAL_SCOPE = new Set(["", "暂无", "多车间", "集团共性"]);

interface CoordinationHit {
  sentence: string;
  /** 当前句所在一级主题下的「范围」（分公司或下属车间/科室） */
  sectionScope: string | null;
}

function normSeg(s: string): string {
  return s.trim().replace(/[/\\]/g, "·");
}

/**
 * 发起/执行部门展示：与顶层分公司一致且非下属单位时只显示分公司名；
 * 下属车间/工段/科室等显示「分公司-单位」；集团职能部门显示部门名本身。
 */
export function formatBranchDeptLabel(branchRaw: string, deptOrScope: string | null | undefined): string {
  const b0 = normSeg(branchRaw);
  const b = b0 === "暂无" ? "集团" : b0;
  const d0 = (deptOrScope ?? "").trim();
  if (!d0 || TRIVIAL_SCOPE.has(d0)) return b;
  const d = normSeg(d0);
  if (d === b) return b;
  if (isBranchCompanyUnit(d)) return d;
  if (
    (/(财务|设备|安环|供应|办公|技术|生产|销售|采购|人力资源|企管|品管)部$/.test(d) ||
      d === "办公室") &&
    !isBranchCompanyUnit(d)
  ) {
    return d;
  }
  if (b.includes("分公司") && b !== "集团") {
    if (d.startsWith(b)) {
      const rest = d.slice(b.length).replace(/^[-·\s]+/, "");
      return rest ? `${b}-${rest}` : b;
    }
    return `${b}-${d}`;
  }
  return d;
}

function inferExecutingDeptRaw(sentence: string): string | null {
  const s = sentence.replace(/\s+/g, " ").trim();
  const named = s.match(
    /申请\s*((?:财务|设备|安环|供应|办公|技术|生产|销售|采购|人力资源|企管|品管)部|办公室|自动化组|信息中心)\s*协助/,
  );
  if (named?.[1]) return named[1].trim();
  const m1 = s.match(/申请\s*([^，。；;\n]{1,14}?)\s*协助/);
  if (m1?.[1]) {
    const x = m1[1].replace(/对近期.*$/u, "").replace(/进行.*$/u, "").trim();
    if (x.length >= 2 && x.length <= 14) return x;
  }
  const m2 = s.match(/请\s*([^，。；;\n]{1,14}?)\s*(协助|对接|配合|支持)/);
  if (m2?.[1]) {
    const x = m2[1].trim();
    if (x.length >= 2 && x.length <= 14) return x;
  }
  const m3 = s.match(/由\s*([^，。；;\n]{1,14}?)\s*(牵头|承办|负责)/);
  if (m3?.[1]) {
    const x = m3[1].trim();
    if (x.length >= 2) return x;
  }
  const m4 = s.match(
    /(财务|设备|安环|供应|办公|技术|生产|销售|采购)部|[\u4e00-\u9fa5·]{2,10}车间|[\u4e00-\u9fa5·]{2,8}工段/,
  );
  if (m4?.[0]) return m4[0].trim();
  return null;
}

/** 在 production_report 子树中收集「需协调类」长文本并拆句（附带一级主题「范围」） */
function collectCoordinationRequests(
  node: Record<string, unknown>,
  path: string[],
  themeScope: string | null,
): CoordinationHit[] {
  const out: CoordinationHit[] = [];
  const pathStr = path.join(">");
  for (const [k, v] of Object.entries(node)) {
    const nextPath = [...path, k];
    let scope = themeScope;
    if (isRecord(v) && /^\d+\.\s/.test(k)) {
      const sv = v["范围"];
      if (typeof sv === "string") {
        const t = normSeg(sv);
        if (t && !TRIVIAL_SCOPE.has(t)) scope = t;
      }
    }
    if (typeof v === "string") {
      const t = v.trim();
      if (!t || t === "暂无") continue;
      const inCoordSection =
        /6\.1|需公司协调|待办协调|协调事项|资产|工程协调|技术攻坚|备件保障|跨部门/.test(pathStr) ||
        /6\.1|需公司协调|协调事项|技术攻坚|备件保障/.test(k);
      if (inCoordSection && /协助|申请|请|需.*部|对接|重估|选型|供货|协调|保障|报件|加急|联系/.test(t)) {
        for (const sentence of splitCoordinationSentences(t)) {
          out.push({ sentence, sectionScope: scope });
        }
      }
    } else if (isRecord(v)) {
      out.push(...collectCoordinationRequests(v, nextPath, scope));
    }
  }
  const seen = new Set<string>();
  const deduped: CoordinationHit[] = [];
  for (const h of out) {
    if (seen.has(h.sentence)) continue;
    seen.add(h.sentence);
    deduped.push(h);
  }
  return deduped;
}

function collectAnomalyStrings(pr: Record<string, unknown>, path: string[]): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(pr)) {
    const nextPath = [...path, k];
    if (k.includes("异常归因") && typeof v === "string") {
      const t = v.trim();
      if (t && t !== "暂无" && t.length >= 12) out.push(t);
    } else if (isRecord(v)) {
      out.push(...collectAnomalyStrings(v, nextPath));
    }
  }
  return out;
}

function collectPlanSectionText(pr: Record<string, unknown>, path: string[]): string {
  const chunks: string[] = [];
  for (const [k, v] of Object.entries(pr)) {
    const nextPath = [...path, k];
    const pathStr = nextPath.join(">");
    if (
      /6\.2|下步计划|改产|检修计划|下步工作重点|管理观察|损纸消纳|待解决事项/.test(pathStr) ||
      /6\.2|下步计划|改产|检修/.test(k)
    ) {
      if (typeof v === "string" && v.trim() && v.trim() !== "暂无") chunks.push(v.trim());
    }
    if (isRecord(v)) chunks.push(collectPlanSectionText(v, nextPath));
  }
  return chunks.join(" ");
}

function normalizeForCompare(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

/** 计划段是否已覆盖该异常的核心信息（极简子串包含） */
function planCoversAnomaly(planNorm: string, anomaly: string): boolean {
  const a = normalizeForCompare(anomaly);
  if (a.length < 10) return true;
  const slice = a.slice(0, Math.min(24, a.length));
  return planNorm.includes(slice);
}

function inferRelatedDepartments(branchName: string, anomaly: string): string {
  const parts = [branchName];
  if (/财务|库存|重估|原料|三胺|价格/.test(anomaly)) parts.push("财务部");
  if (/电网|停机|变压器|DCS|变频|流送|设备|机电|温控/.test(anomaly)) parts.push("设备部");
  if (/安环|环保|消防|隐患|通报/.test(anomaly)) parts.push("安环部");
  if (/供应|备件|采购|供货/.test(anomaly)) parts.push("供应部");
  return [...new Set(parts)].join("、");
}

/**
 * 是否在控制台输出「AI 建议分列」调试。
 * 在控制台执行：`localStorage.setItem('DEBUG_PENDING_AI','1')` 后刷新；关闭：`localStorage.removeItem('DEBUG_PENDING_AI')` 后刷新。
 */
export function isPendingAiSplitDebugEnabled(): boolean {
  try {
    return typeof globalThis.localStorage !== "undefined" &&
      globalThis.localStorage.getItem("DEBUG_PENDING_AI") === "1";
  } catch {
    return false;
  }
}

let pendingAiSplitLogBudget = 20;

function logPendingAiSplit(message: string, payload: Record<string, unknown>): void {
  if (!isPendingAiSplitDebugEnabled()) return;
  if (pendingAiSplitLogBudget-- <= 0) return;
  console.info(`[smart_tasks:PendingAiSuggestion] ${message}`, payload);
}

/**
 * 模型将建议段抄进异常归因时的起始下标；兼容弯引号/直引号、全角斜杠、下一步/下步等。
 */
function findEmbeddedAiSuggestionStart(text: string): number {
  const patterns: RegExp[] = [
    /文末[「](?:下步计划|下一步计划)\s*[/／]\s*需协调[」]/u,
    /文末[\u201c\x22](?:下步计划|下一步计划)\s*[/／\u2044]\s*需协调[\u201d\x22]/u,
    /文末[：:\s]*[「\u201c\x22](?:下步计划|下一步计划)\s*[/／\u2044]\s*需协调[」\u201d\x22]/u,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.index != null && m.index >= 0) return m.index;
  }
  const cue = "未见与上述正文问题";
  const ti = text.indexOf(cue);
  if (ti > 15) {
    const wi = text.lastIndexOf("文末", ti);
    if (wi >= 0 && ti - wi < 140) return wi;
  }
  return -1;
}

/** 模型偶将「文末计划缺口」建议抄进异常归因，从问题正文里截掉该段 */
function stripEmbeddedAiPlanTail(text: string): string {
  const t = text.trim();
  const idx = findEmbeddedAiSuggestionStart(t);
  if (idx < 0) return t;
  return t.slice(0, idx).replace(/[；。\s\n\r]+$/u, "").trim();
}

/** 仅展示从 JSON 摘出的「问题」表述 */
function buildDiscoveredIssueFromAnomaly(anomaly: string): string {
  let t = stripEmbeddedAiPlanTail(anomaly);
  if (!t) return "（无描述）";
  if (t.length > 200) return `${t.slice(0, 200)}…`;
  return t.endsWith("。") ? t : `${t}。`;
}

/** 与「发现的问题」列分离展示的固定 AI 计划建议（导入/解析可复用同一文案） */
export const PENDING_AI_SUGGESTION_TEMPLATE =
  "文末「下步计划 / 需协调」中未见与上述正文问题对应的整改或资源安排，建议补充计划、明确牵头部门与节点后再纳入闭环。";

function buildAiSuggestionText(): string {
  return PENDING_AI_SUGGESTION_TEMPLATE;
}

let rowIdSeq = 0;
function nextRowId(prefix: string, extractionId: string): string {
  rowIdSeq += 1;
  return `${prefix}-${extractionId}-${rowIdSeq}-${Date.now().toString(36)}`;
}

/**
 * 基于已保存的一条提取历史，生成两类待安排任务（不写 storage，由调用方合并进 item）。
 */
export function buildPendingTasksFromSavedReport(item: ExtractionHistoryItem): {
  pendingDailyPlanTasks: PendingDailyPlanTaskRow[];
  pendingAiSuggestionTasks: PendingAiSuggestionTaskRow[];
} {
  const pendingDailyPlanTasks: PendingDailyPlanTaskRow[] = [];
  const pendingAiSuggestionTasks: PendingAiSuggestionTaskRow[] = [];
  const originalText = item.originalText ?? "";
  const branchName = pickBranchCompany(item);
  const branchLabel = branchName === "暂无" ? "集团" : branchName;

  if (item.parsedJson == null || !isRecord(item.parsedJson)) {
    return { pendingDailyPlanTasks, pendingAiSuggestionTasks };
  }

  const pr = getProductionReportRoot(item.parsedJson);
  if (!pr) return { pendingDailyPlanTasks, pendingAiSuggestionTasks };

  const reportDate = pickExtractionDate(item);

  const coordHits = collectCoordinationRequests(pr, [], null);
  for (const { sentence, sectionScope } of coordHits) {
    if (isPromptLikeCoordinationLine(sentence)) continue;
    const desc = sentence.endsWith("。") ? sentence : `${sentence}。`;
    const initiatingDepartment = formatBranchDeptLabel(branchLabel, sectionScope);
    const execRaw = inferExecutingDeptRaw(sentence);
    const executingDepartment = execRaw
      ? formatBranchDeptLabel(branchLabel, execRaw)
      : "待明确";
    pendingDailyPlanTasks.push({
      id: nextRowId("plan", item.id),
      initiatingDepartment,
      executingDepartment,
      reportDate,
      requestDescription: desc,
      extractionHistoryId: item.id,
      jumpNeedle: pickJumpNeedle(originalText, sentence.slice(0, Math.min(sentence.length, 40))),
    });
  }

  const planBlob = normalizeForCompare(collectPlanSectionText(pr, []));
  const anomalies = [...new Set(collectAnomalyStrings(pr, []))];
  for (const anomaly of anomalies) {
    if (/今日运行效率极高|无非计划停机|有效对冲|暂无|正常|良好|合格/.test(anomaly)) continue;
    if (
      /JSON|键名|模板|模型跳过|穿透/.test(anomaly) &&
      !/环保|安全|质量|停机|产量|电耗|水耗|汽耗|纸机|电网|供应|库存|客户/.test(anomaly)
    ) {
      continue;
    }
    if (planCoversAnomaly(planBlob, anomaly)) continue;
    pendingAiSuggestionTasks.push({
      id: nextRowId("ai", item.id),
      relatedDepartments: inferRelatedDepartments(branchLabel === "集团" ? "集团" : branchLabel, anomaly),
      reportDate,
      discoveredIssue: buildDiscoveredIssueFromAnomaly(anomaly),
      aiSuggestion: buildAiSuggestionText(),
      extractionHistoryId: item.id,
      jumpNeedle: pickJumpNeedle(originalText, anomaly.slice(0, Math.min(36, anomaly.length))),
    });
  }

  return { pendingDailyPlanTasks, pendingAiSuggestionTasks };
}

function unitMatchesDeptLabel(label: string, unit: string): boolean {
  const u = unit.trim();
  const lab = label.trim();
  if (lab === u) return true;
  if (u.includes(".")) {
    if (u.split(".").some((seg) => seg.trim() === lab)) return true;
  }
  const br = branchRootFromOrgPath(u);
  if (br) {
    if (lab === br || lab.startsWith(`${br}-`)) return true;
  }
  if (isBranchCompanyUnit(u)) {
    return lab === u || lab.startsWith(`${u}-`);
  }
  return lab.endsWith(`-${u}`) || lab.split("-").some((seg) => seg === u);
}

export function dailyPlanTaskRowVisible(row: PendingDailyPlanTaskRow, perspective: string): boolean {
  if (perspective === GROUP_LEADER_PERSPECTIVE) return true;
  const unit = orgUnitFromPerspective(perspective);
  if (!unit) return true;
  return (
    unitMatchesDeptLabel(row.initiatingDepartment, unit) ||
    unitMatchesDeptLabel(row.executingDepartment, unit)
  );
}

/**
 * 表格展示用：「发现的问题」与「AI 建议」分列；兼容旧数据把两段都塞进 discoveredIssue、或缺少 aiSuggestion。
 */
export function splitPendingAiSuggestionForDisplay(row: PendingAiSuggestionTaskRow): {
  problemText: string;
  suggestionText: string;
} {
  const template = PENDING_AI_SUGGESTION_TEMPLATE;
  const raw = (row.discoveredIssue ?? "").trim();
  const storedSugg = (row.aiSuggestion ?? "").trim();
  const idx = findEmbeddedAiSuggestionStart(raw);

  if (idx >= 0) {
    const head = raw.slice(0, idx).replace(/[；。\s\n\r]+$/u, "").trim();
    const tail = raw.slice(idx).trim();
    const problemText =
      head.length > 0 ? (head.endsWith("。") ? head : `${head}。`) : "（无描述）";
    const suggestionText = storedSugg || tail || template;
    logPendingAiSplit("split: branched at merge marker", {
      rowId: row.id,
      extractionHistoryId: row.extractionHistoryId,
      mergeIdx: idx,
      rawLen: raw.length,
      storedAiSuggestionLen: storedSugg.length,
      problemLen: problemText.length,
      suggestionLen: suggestionText.length,
      suggestionHead: suggestionText.slice(0, 72),
      rawSnippetAroundIdx: raw.slice(Math.max(0, idx - 8), Math.min(raw.length, idx + 56)),
    });
    return { problemText, suggestionText };
  }

  const problemText =
    raw.length === 0 ? "（无描述）" : raw.endsWith("。") ? raw : `${raw}。`;
  const suggestionText = storedSugg || template;
  logPendingAiSplit("split: no merge marker in discoveredIssue", {
    rowId: row.id,
    extractionHistoryId: row.extractionHistoryId,
    rawLen: raw.length,
    hasWenMo: raw.includes("文末"),
    hasXiaYiBu: raw.includes("下一步计划"),
    hasXiaBu: raw.includes("下步计划"),
    hasXuXieTiao: raw.includes("需协调"),
    storedAiSuggestionLen: storedSugg.length,
    problemLen: problemText.length,
    suggestionLen: suggestionText.length,
    suggestionHead: suggestionText.slice(0, 72),
    rawHead: raw.slice(0, 160),
    codeUnitsAroundWenMo: (() => {
      const w = raw.indexOf("文末");
      if (w < 0) return null;
      const seg = raw.slice(w, Math.min(raw.length, w + 40));
      return { offset: w, chars: seg, codes: [...seg].map((c) => c.codePointAt(0)) };
    })(),
  });
  return { problemText, suggestionText };
}

export function aiSuggestionTaskRowVisible(row: PendingAiSuggestionTaskRow, perspective: string): boolean {
  if (perspective === GROUP_LEADER_PERSPECTIVE) return true;
  const unit = orgUnitFromPerspective(perspective);
  if (!unit) return true;
  const parts = row.relatedDepartments.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
  const ut = unit.trim();
  return parts.some((p) => {
    if (p === ut) return true;
    if (ut.includes(".")) return ut.split(".").some((seg) => seg.trim() === p);
    return false;
  });
}
