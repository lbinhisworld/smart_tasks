/**
 * @fileoverview AI 助手：核心记忆、四步流水线（主题判断 → 数据范围 → 数据记录 id → 本机行 JSON 精准作答）及离线启发式。
 */

import {
  resolveDataRecordTasksSystemPrompt,
  resolveDataScopeGeneralSystemPrompt,
  resolveDataScopeReportSystemPrompt,
  resolveFinalDataAnswerSystemPrompt,
  resolveReportDataRecordSystemPrompt,
  resolveTopicRouterSystemPrompt,
} from "./aiChatSkillStore";

export { getBundledCoreMemoryText, getCoreMemoryText, setCoreMemoryText } from "./coreMemoryStorage";

/** 路由判定：报告管理 / 任务管理 / 综合 */
export type AssistantTopic = "report_management" | "task_management" | "general";

export type TopicRouterResult = {
  topic: AssistantTopic;
  topic_rationale: string;
};

export type DataScopeResult = {
  scope_description: string;
  /** 沿用 history「据」或上一轮记录集时，供数据记录步骤优先收窄 */
  baseline_task_codes?: string[];
  baseline_extraction_history_ids?: string[];
};

export type DataRecordResult = {
  task_codes: string[];
  extraction_history_ids: string[];
  rationale: string;
};

// --- ① 主题判断（仅核心记忆）---

export function buildTopicRouterSystemPrompt(): string {
  return resolveTopicRouterSystemPrompt();
}

export function buildTopicRouterUserPayload(question: string): string {
  return `【用户问题】
${question.trim()}`;
}

export function parseTopicRouterJson(raw: string): TopicRouterResult | null {
  try {
    const o = JSON.parse(raw.trim()) as Record<string, unknown>;
    const topic = normalizeTopic(o.topic);
    const topic_rationale =
      typeof o.topic_rationale === "string" ? o.topic_rationale.trim() : "";
    if (!topic_rationale) return null;
    return { topic, topic_rationale };
  } catch {
    return null;
  }
}

function normalizeTopic(v: unknown): AssistantTopic {
  if (v === "report_management" || v === "task_management" || v === "general") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "report" || s.includes("报告")) return "report_management";
    if (s === "task" || s.includes("任务管理")) return "task_management";
    if (s.includes("综合") || s.includes("general")) return "general";
  }
  return "general";
}

export function topicChineseLabel(topic: AssistantTopic): string {
  switch (topic) {
    case "report_management":
      return "报告管理";
    case "task_management":
      return "任务管理";
    case "general":
      return "综合或其它";
    default:
      return "综合或其它";
  }
}

export function formatTopicBlock(router: TopicRouterResult): string {
  return `主题枚举：${router.topic}（${topicChineseLabel(router.topic)}）
判定说明：${router.topic_rationale}`;
}

// --- ② 数据范围判断（用户输入 + 主题结果）---

export function buildDataScopeSystemPrompt(): string {
  return resolveDataScopeGeneralSystemPrompt();
}

export function buildDataScopeUserPayload(question: string, topicBlock: string): string {
  return `【主题判断结果】
${topicBlock}

【用户问题】
${question.trim()}`;
}

function parseOptionalIdArray(o: Record<string, unknown>, key: string): string[] {
  const v = o[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
}

export function parseDataScopeJson(raw: string): DataScopeResult | null {
  try {
    const o = JSON.parse(raw.trim()) as Record<string, unknown>;
    const scope_description =
      typeof o.scope_description === "string" ? o.scope_description.trim() : "";
    const baseline_task_codes = parseOptionalIdArray(o, "baseline_task_codes");
    const baseline_extraction_history_ids = parseOptionalIdArray(o, "baseline_extraction_history_ids");
    if (
      !scope_description &&
      baseline_task_codes.length === 0 &&
      baseline_extraction_history_ids.length === 0
    ) {
      return null;
    }
    return {
      scope_description:
        scope_description ||
        "沿用近期 history 中上一轮「据」内的记录标识为本轮基线，并结合用户追问收窄后选行。",
      baseline_task_codes,
      baseline_extraction_history_ids,
    };
  } catch {
    return null;
  }
}

/** 报告主题 · 数据范围：提取日期 + 分公司名称 */
export type ReportDataScopeResult = {
  scope_summary: string;
  report_dates: string[];
  branch_companies: string[];
};

export function buildDataScopeSystemPromptForReport(): string {
  return resolveDataScopeReportSystemPrompt();
}

export function parseDataScopeReportJson(raw: string): ReportDataScopeResult | null {
  try {
    const o = JSON.parse(raw.trim()) as Record<string, unknown>;
    const scope_summary = typeof o.scope_summary === "string" ? o.scope_summary.trim() : "";
    const rd = o.report_dates;
    const bc = o.branch_companies;
    const report_dates = Array.isArray(rd)
      ? rd.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)
      : [];
    const branch_companies = Array.isArray(bc)
      ? bc.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)
      : [];
    return { scope_summary, report_dates, branch_companies };
  } catch {
    return null;
  }
}

export function formatReportDataScopeFeedback(
  r: ReportDataScopeResult,
  opts?: { stalemateNoExtractDate?: boolean },
): string {
  const dates = r.report_dates.length
    ? r.report_dates.join("、")
    : opts?.stalemateNoExtractDate
      ? "（判定到的日期在本机可见提取历史中无对应「提取日期」，未纳入检索范围）"
      : "（未指定：全部报告日期，在视角可见数据内检索）";
  const branches = r.branch_companies.length
    ? r.branch_companies.join("、")
    : "（未指定：全部报告主体/分公司，在视角可见数据内检索）";
  const sum = r.scope_summary ? `\n说明：${r.scope_summary}` : "";
  return `涉及报告日期：${dates}\n报告主体（分公司名称）：${branches}${sum}`;
}

// --- ③ 数据记录判断（用户输入 + 主题 + 范围 + 双动态记忆）---

export function buildDataRecordSystemPrompt(): string {
  return resolveDataRecordTasksSystemPrompt();
}

/** 数据范围阶段给出的、须在数据记录步骤优先考虑的 id 集合 */
export type DataScopeBaselineIds = {
  task_codes: string[];
  extraction_history_ids: string[];
};

export function buildDataRecordUserPayload(
  question: string,
  topicBlock: string,
  scopeDescription: string,
  baseline?: DataScopeBaselineIds | null,
): string {
  const hasBase =
    baseline && (baseline.task_codes.length > 0 || baseline.extraction_history_ids.length > 0);
  const baselineBlock = hasBase
    ? `【记录标识基线（须优先在此集合内匹配，再结合【用户问题】筛选；勿编造未出现在此基线与本机记忆中的编号/id）】
任务编号：${baseline!.task_codes.length ? baseline!.task_codes.join("、") : "（无）"}
提取历史 id：${baseline!.extraction_history_ids.length ? baseline!.extraction_history_ids.join("、") : "（无）"}

`
    : "";
  return `【主题判断结果】
${topicBlock}

【数据范围判断结果】
${scopeDescription}

${baselineBlock}【用户问题】
${question.trim()}`;
}

export function parseDataRecordJson(raw: string): DataRecordResult | null {
  try {
    const o = JSON.parse(raw.trim()) as Record<string, unknown>;
    const tc = o.task_codes;
    const ei = o.extraction_history_ids;
    const rationale = typeof o.rationale === "string" ? o.rationale.trim() : "";
    const task_codes = Array.isArray(tc)
      ? tc.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)
      : [];
    const extraction_history_ids = Array.isArray(ei)
      ? ei.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)
      : [];
    return { task_codes, extraction_history_ids, rationale: rationale || "（无说明）" };
  } catch {
    return null;
  }
}

/** 报告主题 · 数据记录判断：结构化 JSON + 形态说明 → 记录集说明 + 最终答复（在第 4 步展示） */
export type ReportDataRecordJudgmentResult = {
  record_set_summary: string;
  answer: string;
};

export function truncateJsonForLlm(data: unknown, maxLen: number): string {
  const s = JSON.stringify(data);
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}\n…（JSON 已截断，优先依据前文字段）`;
}

export function buildReportDataRecordSystemPrompt(): string {
  return resolveReportDataRecordSystemPrompt();
}

export function buildReportDataRecordUserPayload(
  question: string,
  schemaDoc: string,
  reportsStructured: unknown,
  contextNote?: string,
): string {
  const body = truncateJsonForLlm(reportsStructured, 120_000);
  const head = contextNote?.trim() ? `${contextNote.trim()}\n\n` : "";
  return `${head}【用户询问】
${question.trim()}

【production_report 结构化说明（字段树模板）】
${schemaDoc}

【本机报告结构化 JSON 数组】
${body}`;
}

export function parseReportDataRecordJudgmentJson(raw: string): ReportDataRecordJudgmentResult | null {
  try {
    const o = JSON.parse(raw.trim()) as Record<string, unknown>;
    const record_set_summary =
      typeof o.record_set_summary === "string" ? o.record_set_summary.trim() : "";
    const answer = typeof o.answer === "string" ? o.answer.trim() : "";
    if (!record_set_summary && !answer) return null;
    return {
      record_set_summary: record_set_summary || "（无记录集说明）",
      answer: answer || "（无正文）",
    };
  } catch {
    return null;
  }
}

// --- ④ 具体数据返回（用户问题 + 本机数据行 JSON）---

export function buildFinalDataAnswerSystemPrompt(): string {
  return resolveFinalDataAnswerSystemPrompt();
}

export function buildFinalDataAnswerUserPayload(question: string, rowsJson: string): string {
  return `【用户问题】
${question.trim()}

【本机数据行 JSON】
${rowsJson}`;
}

export function parseFinalAnswerJson(raw: string): string | null {
  try {
    const o = JSON.parse(raw.trim()) as Record<string, unknown>;
    const answer = typeof o.answer === "string" ? o.answer.trim() : "";
    return answer || null;
  } catch {
    return null;
  }
}

/** 离线：与路由枚举一致的启发式主题 */
export function inferOfflineTopic(question: string): AssistantTopic {
  const s = question.trim();
  if (!s) return "general";
  const reportHit =
    /报告|提取|日报|KPI|产量|提取历史|结构化|分公司名称|production_report/i.test(s) ||
    /看板.*报告|报告.*看板/.test(s);
  const taskHit =
    /任务列表|新建任务|编辑任务|任务编号|大类|子类|状态|协调方|进展|计划历史|QF-[A-Z]{2}/i.test(s);
  if (reportHit && !taskHit) return "report_management";
  if (taskHit && !reportHit) return "task_management";
  if (reportHit && taskHit) return "general";
  if (/看板|风险|关注|环形|当前视角|总览|逾期|节点/.test(s)) return "general";
  if (/同步|数据中台|清洗|接口/.test(s)) return "general";
  return "general";
}

export function inferOfflineIntentSummary(question: string): string {
  const s = question.trim();
  if (!s) return "未检测到有效文字，可能是空输入。";
  if (/报告|提取|日报|KPI|产量|提取历史|结构化/.test(s)) {
    return "判断为与「报告管理」或「数据看板 · 报告看板」相关的咨询。";
  }
  if (/任务列表|新建任务|编辑任务|任务编号|大类|子类|状态|协调方|进展|计划历史/.test(s)) {
    return "判断为与「任务管理」相关的咨询。";
  }
  if (/看板|风险|关注|环形|当前视角|总览|逾期|节点/.test(s)) {
    return "判断为与「数据看板」相关的咨询。";
  }
  if (/同步|数据中台|清洗|接口/.test(s)) {
    return "判断为与「数据中台」或外部数据相关的咨询。";
  }
  return "判断为通用或跨模块咨询；将结合系统常驻知识做说明。";
}
