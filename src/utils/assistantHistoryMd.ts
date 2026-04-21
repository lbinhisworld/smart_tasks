/**
 * @fileoverview AI 助手交互压缩历史：Markdown 形态持久化（history.md），供意图路由与导出使用。
 *
 * - 每条保留：概/意/点（压缩）；据=范围 + **任务编号与提取历史 id 全文**（不截断）。
 * - 超长时：**优先保留近期**明细；从**最旧**的近期条开始并入「滚动摘要」；远期摘要另附抽出的 id。
 */

const STORAGE_KEY = "qifeng_assistant_history_md_v1";

/** 单条目标长度（概意点收紧后尽量接近；据 内 id 不截断） */
const MAX_SINGLE_ENTRY_SOFT_CHARS = 220;
/** 单条硬上限（含多任务编号 + 多 UUID） */
const MAX_SINGLE_ENTRY_HARD_CHARS = 4000;
/** 滚动摘要主文上限（id 另附） */
const MAX_ROLLED_MAIN_CHARS = 120;
/** 滚动摘要全文上限（主文 + 保留的 id 串） */
const MAX_ROLLED_TOTAL_CHARS = 900;

/** history.md 全文长度上限（含标题等） */
const MAX_MARKDOWN_FILE_CHARS = 500;
/** 至少保留的近期条数（再超预算才继续向滚动摘要合并） */
const MIN_RECENT_ENTRIES = 4;
/** 供主题路由注入时的最大字符数（避免撑爆上下文） */
const MAX_HISTORY_FOR_ROUTER_CHARS = 12000;

export type AssistantHistoryTurnInput = {
  userText: string;
  topicLabel: string;
  topicKeywords: string;
  scopeDescription: string;
  recordIdsSummary: string;
  answerSummary: string;
};

type Persisted = {
  v: 1;
  rolledSummary: string;
  /** 按时间顺序：旧 → 新；合并时从首部取出 */
  recent: string[];
};

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { v: 1, rolledSummary: "", recent: [] };
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return { v: 1, rolledSummary: "", recent: [] };
    const rec = o as Record<string, unknown>;
    const rolled = typeof rec.rolledSummary === "string" ? rec.rolledSummary : "";
    const r = rec.recent;
    const recent = Array.isArray(r)
      ? r.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)
      : [];
    return { v: 1, rolledSummary: rolled.trim(), recent };
  } catch {
    return { v: 1, rolledSummary: "", recent: [] };
  }
}

function savePersisted(p: Persisted): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

function stripNoise(s: string): string {
  return s
    .replace(/[#*`_[\]()>]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\|/g, "｜")
    .trim();
}

function limitChars(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

/** 从一段文本中抽出任务编号与提取历史 UUID，去重后串联（供远期摘要保留关键 id） */
function collectTaskAndHistoryIds(fullCore: string): string {
  const codes = [...fullCore.matchAll(/QF-[A-Z]{2}-[A-Z]{3}-\d{4}/gi)].map((m) => m[0]);
  const uuids = [
    ...fullCore.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi),
  ].map((m) => m[0]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of codes) {
    if (!seen.has(`c:${c}`)) {
      seen.add(`c:${c}`);
      out.push(c);
    }
  }
  for (const u of uuids) {
    const k = u.toLowerCase();
    if (!seen.has(`u:${k}`)) {
      seen.add(`u:${k}`);
      out.push(u);
    }
  }
  return out.join("、");
}

/**
 * 单轮压缩：概=用户关切要点；意=主题/路由；据=范围+记录 id（**id 全文保留**）；点=结论要点
 */
export function compressAssistantTurn(i: AssistantHistoryTurnInput): string {
  const idsRaw = stripNoise(i.recordIdsSummary).trim();
  const gistFull = stripNoise(i.userText);
  const intentFull = stripNoise(`${i.topicLabel}/${i.topicKeywords}`);
  const scopeFull = stripNoise(i.scopeDescription);
  const pointFull = stripNoise(i.answerSummary);

  let gMax = 28;
  let iMax = 24;
  let sMax = 40;
  let pMax = 28;

  const build = (): string => {
    const gist = limitChars(gistFull, gMax);
    const intent = limitChars(intentFull, iMax);
    const scopeShort = limitChars(scopeFull, sMax);
    const keyData = idsRaw && idsRaw !== "—" ? `${scopeShort};${idsRaw}` : scopeShort;
    const point = limitChars(pointFull, pMax);
    return `概:${gist}|意:${intent}|据:${keyData}|点:${point}`;
  };

  let line = build();
  while (line.length > MAX_SINGLE_ENTRY_SOFT_CHARS && (gMax > 8 || iMax > 6 || sMax > 6 || pMax > 8)) {
    if (gMax > 8) gMax -= 2;
    if (iMax > 6) iMax -= 2;
    if (sMax > 6) sMax -= 2;
    if (pMax > 8) pMax -= 2;
    line = build();
  }

  while (line.length > MAX_SINGLE_ENTRY_HARD_CHARS && (gMax > 4 || iMax > 4 || sMax > 4 || pMax > 4)) {
    if (gMax > 4) gMax -= 1;
    if (iMax > 4) iMax -= 1;
    if (sMax > 4) sMax -= 1;
    if (pMax > 4) pMax -= 1;
    line = build();
  }

  if (line.length > MAX_SINGLE_ENTRY_HARD_CHARS) {
    line = limitChars(line, MAX_SINGLE_ENTRY_HARD_CHARS);
  }
  return line;
}

/** 远期合并：主文压缩，另附本批中出现的任务编号与 UUID，避免关键 id 丢失 */
export function compressRolledHistory(fullCore: string): string {
  const idBlob = collectTaskAndHistoryIds(fullCore);
  const flat = stripNoise(fullCore.replace(/\n/g, " "));
  const lines = fullCore.split("\n").filter((l) => l.trim());
  const n = lines.length;
  if (!flat) return idBlob || "";
  let main = n > 1 ? `[历${n}轮]${flat}` : flat;
  main = limitChars(main, MAX_ROLLED_MAIN_CHARS);
  if (!idBlob) return limitChars(main, MAX_ROLLED_TOTAL_CHARS);
  const withIds = `${main}|id:${idBlob}`;
  return limitChars(withIds, MAX_ROLLED_TOTAL_CHARS);
}

export function serializeAssistantHistoryMarkdown(p: Persisted): string {
  const head: string[] = ["# AI 助手交互压缩历史", ""];
  if (p.rolledSummary) {
    head.push("## 远期摘要（已高度压缩）", "", `> ${p.rolledSummary}`, "");
  }
  head.push("## 近期记录（优先完整）", "");
  if (p.recent.length === 0) head.push("*（暂无）*", "");
  else for (const r of p.recent) head.push(`- ${r}`, "");
  return head.join("\n").trimEnd() + "\n";
}

function persistMarkdownView(p: Persisted): void {
  savePersisted(p);
  try {
    localStorage.setItem(`${STORAGE_KEY}_markdown`, serializeAssistantHistoryMarkdown(p));
  } catch {
    /* ignore */
  }
}

function markdownLength(p: Persisted): number {
  return serializeAssistantHistoryMarkdown(p).length;
}

/**
 * 追加一轮；超限时将 **最早** 的近期条并入滚动摘要，**最近** 若干条尽量保留。
 */
export function appendAssistantHistoryTurn(input: AssistantHistoryTurnInput): void {
  const line = compressAssistantTurn(input);
  const p = loadPersisted();
  p.recent.push(line);

  while (markdownLength(p) > MAX_MARKDOWN_FILE_CHARS) {
    if (p.recent.length > MIN_RECENT_ENTRIES) {
      const oldest = p.recent.shift()!;
      const mergeCore = [p.rolledSummary, oldest].filter(Boolean).join("\n");
      p.rolledSummary = compressRolledHistory(mergeCore);
      continue;
    }
    if (p.recent.length > 0) {
      const oldest = p.recent.shift()!;
      const mergeCore = [p.rolledSummary, oldest].filter(Boolean).join("\n");
      p.rolledSummary = compressRolledHistory(mergeCore);
      continue;
    }
    if (p.rolledSummary.length > 20) {
      p.rolledSummary = compressRolledHistory(p.rolledSummary);
      continue;
    }
    break;
  }
  persistMarkdownView(p);
}

export function readAssistantHistoryMarkdownFile(): string {
  try {
    const mirror = localStorage.getItem(`${STORAGE_KEY}_markdown`);
    if (mirror) return mirror;
  } catch {
    /* ignore */
  }
  return serializeAssistantHistoryMarkdown(loadPersisted());
}

/** 与 TopicRouterResult.topic 对齐，用于跟进问句从 history 延续主题 */
export type InferredTopicFromHistory = "report_management" | "task_management" | "general";

/**
 * 从 history.md 正文中最近若干条压缩行（`- 概:…|意:…|据:…`）推断上一轮业务主题。
 */
export function inferTopicFromHistoryMarkdown(historyText: string): InferredTopicFromHistory | null {
  const lines = historyText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^-\s*概:/.test(l));
  const look = lines.slice(-10);
  for (let i = look.length - 1; i >= 0; i--) {
    const line = look[i].replace(/^-\s*概:\s*/, "").trim();
    const im = line.match(/意:([^|｜]+)/);
    if (!im) continue;
    const intentPart = im[1].trim();
    if (intentPart.includes("报告管理")) return "report_management";
    if (intentPart.includes("任务管理")) return "task_management";
  }
  return null;
}

/**
 * 相对上一轮 history 推断的主题，判断本轮是否更像「换题」而非简短跟进。
 * 为 true 时须保留模型本轮输出的 topic（通常为 general），**不**再用 history 覆盖主题。
 */
export function intentTopicSwitchedFromPrior(
  userQuestion: string,
  topicRationale: string,
  priorTopic: "report_management" | "task_management",
): boolean {
  const q = userQuestion.trim();
  const r = topicRationale.trim();
  if (
    /切换|转为|改问|换了个|新话题|不同于此前|转而关心|另外想了解|现在开始问|接下来问|转向/i.test(r)
  ) {
    return true;
  }
  const reportCue =
    /报告管理|生产日报|提取历史|报告看板|KPI|产量指标|分公司.*日报|安环通报/i.test(q);
  const taskCue =
    /QF-[A-Z]{2}-[A-Z]{3}-\d{4}|任务编号|任务状态|计划历史|协调方|任务列表|重点任务(?!系统)/i.test(q);
  if (priorTopic === "task_management" && reportCue) return true;
  if (priorTopic === "report_management" && taskCue) return true;
  return false;
}

const RECENT_SECTION = "## 近期记录";
const ROLLED_SECTION = "## 远期摘要（已高度压缩）";

/**
 * 根据用户在配置中编辑的 history.md 正文，解析并写回结构化存储与 mirror。
 */
export function saveAssistantHistoryMarkdownFromEditor(
  md: string,
): { ok: true } | { ok: false; error: string } {
  const normalized = md.replace(/\r\n/g, "\n");
  const recentIdx = normalized.indexOf(RECENT_SECTION);
  if (recentIdx < 0) {
    return { ok: false, error: `未找到「${RECENT_SECTION}」章节，无法解析近期记录。` };
  }

  const rolledIdx = normalized.indexOf(ROLLED_SECTION);
  let rolledSummary = "";
  if (rolledIdx >= 0 && rolledIdx < recentIdx) {
    const between = normalized.slice(rolledIdx + ROLLED_SECTION.length, recentIdx);
    const parts: string[] = [];
    for (const line of between.split("\n")) {
      const t = line.trimEnd();
      if (t.startsWith(">")) {
        parts.push(t.replace(/^>\s?/, "").trim());
      }
    }
    rolledSummary = parts.join("\n").trim();
  }

  let tail = normalized.slice(recentIdx + RECENT_SECTION.length);
  const firstNl = tail.indexOf("\n");
  tail = firstNl >= 0 ? tail.slice(firstNl + 1) : "";

  const recent: string[] = [];
  for (const rawLine of tail.split("\n")) {
    const line = rawLine.trimEnd();
    if (/^##\s/.test(line.trim())) break;
    const t = line.trim();
    if (t.includes("（暂无）")) break;
    const bm = t.match(/^-\s+(.+)$/);
    if (bm) recent.push(bm[1].trim());
  }

  const p: Persisted = { v: 1, rolledSummary, recent };
  persistMarkdownView(p);
  return { ok: true };
}

/**
 * 主题路由注入用：取当前 history.md 正文，超长时 **保留末尾**（更近的交互）。
 */
export function getAssistantHistoryForRouter(maxChars = MAX_HISTORY_FOR_ROUTER_CHARS): string {
  const raw = readAssistantHistoryMarkdownFile().trim();
  if (!raw) return "（暂无历史）";
  if (raw.length <= maxChars) return raw;
  const tail = raw.slice(-maxChars);
  return `${tail}\n\n…（上文已截断，保留更近的 history 内容）`;
}

export function downloadAssistantHistoryMd(): void {
  const body = readAssistantHistoryMarkdownFile();
  const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "history.md";
  a.click();
  URL.revokeObjectURL(url);
}
