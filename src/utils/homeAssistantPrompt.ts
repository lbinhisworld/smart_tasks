/**
 * @fileoverview AI 助手：核心记忆、四步流水线（主题判断 → 数据范围 → 数据记录 id → 本机行 JSON 精准作答）及离线启发式。
 */

import coreMemoryMarkdown from "../../docs/核心记忆模块.md?raw";
import { loadReportDynamicMemoryText } from "./reportDynamicMemory";
import { loadTaskDynamicMemoryText } from "./taskDynamicMemory";

/** 路由判定：报告管理 / 任务管理 / 综合 */
export type AssistantTopic = "report_management" | "task_management" | "general";

export type TopicRouterResult = {
  topic: AssistantTopic;
  topic_rationale: string;
};

export type DataScopeResult = {
  scope_description: string;
};

export type DataRecordResult = {
  task_codes: string[];
  extraction_history_ids: string[];
  rationale: string;
};

export const HOME_ASSISTANT_CORE_MEMORY = coreMemoryMarkdown.trim();

// --- ① 主题判断（仅核心记忆）---

export function buildTopicRouterSystemPrompt(): string {
  return `你是「齐峰新材 · 重点任务管理系统」AI 助手的**主题路由**模块。你只根据【系统常驻知识】与用户问题，判断用户**主要**咨询方向。

【系统常驻知识】
${HOME_ASSISTANT_CORE_MEMORY}

【你必须输出的 JSON】
只输出一个 JSON 对象（不要 markdown 代码围栏），恰好两个字符串键：
- "topic"：必须是以下**之一**（英文枚举，照抄）：
  - "report_management" — 用户主要关心**报告管理**或报告看板/KPI/提取历史。
  - "task_management" — 用户主要关心**任务管理**或任务列表/编号/状态等。
  - "general" — 无法二选一或综合/导航类。
- "topic_rationale"：1～3 句中文，给用户看（不要编造功能）。

Constraints：topic_rationale 为中文；topic 三选一英文枚举。`;
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
  return `你是**数据范围判断**助手。根据【用户问题】与【主题判断结果】，用简短中文概括：在当前主题下，用户需要关注哪一类数据子集的特征（例如：某分公司发起的任务、某提取日期的日报、某状态任务等）。不要列出具体任务编号或历史 id。

只输出一个 JSON 对象（不要 markdown 代码围栏），恰好一个字符串键：
- "scope_description"：1～3 句中文，概括数据范围特征。

不得编造系统中不存在的分公司名或模块。`;
}

export function buildDataScopeUserPayload(question: string, topicBlock: string): string {
  return `【主题判断结果】
${topicBlock}

【用户问题】
${question.trim()}`;
}

export function parseDataScopeJson(raw: string): DataScopeResult | null {
  try {
    const o = JSON.parse(raw.trim()) as Record<string, unknown>;
    const scope_description =
      typeof o.scope_description === "string" ? o.scope_description.trim() : "";
    if (!scope_description) return null;
    return { scope_description };
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
  return `你是**数据范围判断**助手。**主题已判定为「报告管理」**。

请根据【用户问题】与【主题判断结果】，判断用户涉及的：
1. **报告提取日期**：YYYY-MM-DD 数组（report_dates）
2. **报告主体（分公司名称）**：与系统一致的字符串数组（branch_companies），如「广西分公司」
3. **scope_summary**：1～2 句中文概括（可选）

**重要**：用户**未在问题中明确提及**某一维（日期或分公司）时，该维必须输出 **[]**，表示**不限制**（即该维为「全部」）；**不要**因不确定而省略键或填占位内容。[] 与「无数据」无关，仅表示不过滤该维。

**日期约束**：\`report_dates\` 中的 **YYYY-MM-DD 必须为本机真实存在的「提取日期」**；**禁止**臆造或猜测年份。用户仅在问题中写「M月D日」而无年份时，\`report_dates\` 可填 **[]**（系统会仅依据本机提取历史中实际出现的日期解析范围，不会把 2025、2027 等一并纳入）。

只输出一个 JSON 对象（不要 markdown 代码围栏），恰好三个键：
- "scope_summary"：字符串，可为空字符串
- "report_dates"：字符串数组
- "branch_companies"：字符串数组`;
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
  const taskDyn = loadTaskDynamicMemoryText();
  const reportDyn = loadReportDynamicMemoryText();
  return `你是**数据记录判断**助手。根据【用户问题】【主题判断结果】【数据范围判断结果】，从下列动态记忆中，找出**确实出现**的记录标识：
- 任务：编号格式 QF-XX-YYY-NNNN（须与【任务动态记忆】中某行一致）
- 日报提取历史：【日报动态记忆】每条中的「历史ID」字段（UUID 形态）

只输出一个 JSON 对象（不要 markdown 代码围栏），包含：
- "task_codes"：字符串数组，可为空
- "extraction_history_ids"：字符串数组，可为空
- "rationale"：1～2 句中文，说明如何匹配（勿编造未在记忆出现的编号/id）

【任务动态记忆】
${taskDyn}

【日报动态记忆】
${reportDyn}`;
}

export function buildDataRecordUserPayload(
  question: string,
  topicBlock: string,
  scopeDescription: string,
): string {
  return `【主题判断结果】
${topicBlock}

【数据范围判断结果】
${scopeDescription}

【用户问题】
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
  return `你是齐峰新材生产日报「数据记录判断与应答」助手。

你将收到：
1. 【用户询问】
2. 【production_report 结构化说明】—— JSON 树模板，用于理解「production_report」下各一级/二级主题及叶子字段含义（**不是当日真实数据**）。
3. 【本机报告结构化 JSON 数组】—— 每条为一次提取保存的真实结构化结果（含 extraction_id、分公司名称、提取日期、production_report 等），**是唯一事实来源**。

规则：
- 仅依据第 3 部分作答；可对照第 2 部分理解键名与层级；禁止编造未出现的数值、日期或分公司。
- **主题匹配须覆盖「字段取值」**：除对照键名、路径外，须遍历 production_report 下所有**叶子字符串**（含列表中的文本项），检索【用户询问】中的主题词、同义/近义表述及合理变体；若某条记录**任一取值**中出现与用户关切相关的内容，必须纳入答复，不得仅因键名不含该词而忽略整条或整段。
- 用户问「安全隐患、违章、风险」等时，除「安环通报自查」「危化品管理」外，务必同时查看 **「1.2 安全隐患自查与执行」** 下 **「精益管理执行(手势/三三制)」** 等同级字段，实务中隐患常记在该类描述里。
- 输出**一个** JSON 对象（不要使用 markdown 代码围栏），恰好两个字符串键：
  - "record_set_summary"：说明本答复基于哪些提取日期、分公司、几条记录（可列 extraction_id）。
  - "answer"：给用户的完整答复，可使用 Markdown，小标题用 ## / ###。

若第 3 部分为空数组或 production_report 均为空，须在 answer 中说明并建议用户到「报告管理」核对。`;
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
  return `你是齐峰新材重点任务管理系统的**数据查询**助手。你将收到【用户问题】与【本机数据行 JSON】（已由前序步骤解析，仅包含本机真实存在的任务行与/或日报提取历史行）。

规则：
- **仅依据** JSON 中的字段作答，精准引用；不得编造未出现的任务编号、日期或分公司名。
- **主题匹配须覆盖「单元格取值」**：除列名/字段名外，须在各行各列的**文本内容**中检索【用户问题】中的关键词与同义表述；若某行任一字段值命中用户关切，必须引用该行相关事实，不得仅因列名不含该词而漏答。
- 若 JSON 中 \`rows\` 为空数组，明确告知用户未能在本机定位到数据行，并建议到「任务管理」「报告管理」核对或缩小问题范围。
- 回答面向业务用户，简洁清晰，可用短列表。

只输出一个 JSON 对象（不要 markdown 代码围栏），恰好一个字符串键：
- "answer"：完整中文答复；可使用 **Markdown** 排版，小标题请用 \`## 标题\` 或 \`### 标题\` 便于阅读。`;
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
