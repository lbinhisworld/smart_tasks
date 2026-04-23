/**
 * @fileoverview AI 助手：核心记忆、四步流水线（主题判断 → 数据范围 → 数据记录 id → 本机行 JSON 精准作答）及离线启发式。
 */

import {
  resolveDataRecordTasksSystemPrompt,
  resolveDataScopeGeneralSystemPrompt,
  resolveDataScopeReportSystemPrompt,
  resolveFinalDataAnswerSystemPrompt,
  resolveOperationConfirmSystemPrompt,
  resolveOperationExecuteSystemPrompt,
  resolveReportDataRecordSystemPrompt,
  resolveTopicRouterSystemPrompt,
} from "./aiChatSkillStore";
import {
  getAssistantHistoryForRouter,
  inferTopicFromHistoryMarkdown,
  intentTopicSwitchedFromPrior,
} from "./assistantHistoryMd";
import {
  ASSISTANT_UI_ACTION_TOKENS_HELP,
  dispatchAssistantUiActions,
  mapUiActionTokens,
} from "./assistantUiActions";

export { getBundledCoreMemoryText, getCoreMemoryText, setCoreMemoryText } from "./coreMemoryStorage";

/** 询问：走数据检索流水线；操作：走确认 + 行动作 */
export type InteractionMode = "inquiry" | "operation";

/** 路由判定：数据看板 / 报告管理 / 任务管理 / 综合 */
export type AssistantTopic = "dashboard" | "report_management" | "task_management" | "general";

export type TopicRouterResult = {
  interaction_mode: InteractionMode;
  topic: AssistantTopic;
  topic_rationale: string;
};

export type OperationConfirmResult = {
  module: AssistantTopic;
  operation: string;
  operation_info: Record<string, unknown>;
  user_facing_summary: string;
};

/** 与核心记忆「日报正文」一致：短于该长度视为尚未提供有效正文 */
export const DAILY_REPORT_BODY_MIN_LEN = 20;

export function getDailyReportBodyFromOperationInfo(info: Record<string, unknown>): string {
  const keys = ["daily_report_body", "日报正文", "report_body", "body"] as const;
  for (const k of keys) {
    const v = info[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** 同一轮用户消息中，命令行后的多行正文 */
export function tryExtractDailyReportBodyFromUserTurn(userText: string): string | null {
  const t = userText.trim();
  if (!t) return null;
  const lines = t.split(/\r?\n/);
  if (lines.length >= 2) {
    const first = lines[0].trim();
    if (
      /^(新建|录入|上传|提交)?日报$/i.test(first) ||
      /^输入报告$/i.test(first) ||
      /^(我要|请|帮忙)?(新建|录入|上传|提交|写|填).{0,6}日报$/i.test(first)
    ) {
      const rest = lines.slice(1).join("\n").trim();
      if (rest.length >= DAILY_REPORT_BODY_MIN_LEN) return rest;
    }
  }
  const m = t.match(/(?:^|[\n])(?:新建|录入|上传|提交)?日报\s*[:：]?\s*\n([\s\S]+)$/i);
  if (m && m[1].trim().length >= DAILY_REPORT_BODY_MIN_LEN) return m[1].trim();
  return null;
}

export function isReportManagementIntakeOperation(confirm: OperationConfirmResult): boolean {
  if (confirm.module !== "report_management") return false;
  const op = confirm.operation.replace(/\s/g, "");
  return /输入报告|新建日报|录入日报|上传日报|提交日报|日报录入|录日报/.test(op);
}

/** 合并模型输出与同一轮用户正文；缺正文时强制补充「请提供日报原文」 */
export function normalizeReportIntakeConfirm(
  confirm: OperationConfirmResult,
  userText: string,
): OperationConfirmResult {
  if (!isReportManagementIntakeOperation(confirm)) return confirm;
  const opInfo: Record<string, unknown> = { ...confirm.operation_info };
  if (getDailyReportBodyFromOperationInfo(opInfo).length >= DAILY_REPORT_BODY_MIN_LEN) {
    return { ...confirm, operation_info: opInfo };
  }
  const inline = tryExtractDailyReportBodyFromUserTurn(userText);
  if (inline) opInfo.daily_report_body = inline;
  let summary = confirm.user_facing_summary.trim();
  if (getDailyReportBodyFromOperationInfo(opInfo).length < DAILY_REPORT_BODY_MIN_LEN) {
    if (!summary.includes("请提供日报原文")) {
      summary = `请提供日报原文。\n\n${summary}`.trim();
    }
  }
  return { ...confirm, operation_info: opInfo, user_facing_summary: summary };
}

/** 是否需在聊天区下一轮收集日报正文（核心记忆 1.2） */
export function shouldAwaitDailyReportBodyInChat(confirm: OperationConfirmResult): boolean {
  if (!isReportManagementIntakeOperation(confirm)) return false;
  return getDailyReportBodyFromOperationInfo(confirm.operation_info).length < DAILY_REPORT_BODY_MIN_LEN;
}

export type OperationExecuteResult = {
  ui_action_tokens: string[];
  rationale: string;
};

/**
 * 模型常把「新建/录入日报」误判为 inquiry，进而走报告问答并编造日报正文。
 * 在用户明显是**录入动作**且非**请教/统计类**问句时，强制改为 operation + 报告管理。
 */
export function coerceOperationModeForReportIntake(router: TopicRouterResult, userText: string): TopicRouterResult {
  if (router.interaction_mode === "operation") return router;
  const q = userText.trim();
  if (!q) return router;

  const intakeCue =
    /新建日报|录入日报|上传日报|提交日报|录日报|记日报|贴日报|粘贴日报|我要(?:录|传|提交|新建|写一份|填).*日报|写(?:一份|个)日报(?!怎么|如何|怎样)|打开(?:报告|日报).*提取|去报告管理.*(?:录|新建|上传|提交)|进报告管理.*(?:录|新建|日报)|报告管理.*(?:录入|新建|上传)(?:日报)?/i.test(
      q,
    );
  const inquiryAboutReport =
    /怎么|如何|怎样|什么是|为何|为什么|是否|介绍|说明|流程|步骤|模板|范例|要求|规范|标准|格式|注意|统计|查询|对比|分析|列出|汇总|检索|有多少|哪些|查看.*历史|提取历史|KPI|产量|指标|完成情况/i.test(
      q,
    );

  if (!intakeCue || inquiryAboutReport) return router;

  if (
    router.topic !== "report_management" &&
    router.topic !== "general" &&
    router.topic !== "dashboard"
  ) {
    return router;
  }

  return {
    interaction_mode: "operation",
    topic: "report_management",
    topic_rationale: `${router.topic_rationale}（系统规则：识别为日报录入/新建类操作意图，已从「询问」纠正为「操作」，须按核心记忆「主要操作描述·输入报告」引导，不得生成模拟日报全文。）`,
  };
}

/**
 * 模型常把「新建/创建任务」误判为 inquiry。在用户明显是**打开新建表单**而非**请教规则或统计**时，强制改为 operation + 任务管理。
 */
export function coerceOperationModeForTaskManualNew(router: TopicRouterResult, userText: string): TopicRouterResult {
  if (router.interaction_mode === "operation") return router;
  const q = userText.trim();
  if (!q) return router;

  const taskNewCue =
    /^手工新建任务[。.!！\s]*$/i.test(q) ||
    /^新建任务[。.!！\s]*$/i.test(q) ||
    /^创建任务[。.!！\s]*$/i.test(q) ||
    /(?:我要|帮我|请)(?:你)?(?:手工)?(?:新建|创建)(?:一条)?任务/i.test(q) ||
    /打开(?:手工)?新建任务|进入(?:手工)?新建任务/i.test(q) ||
    /任务管理.*(?:手工)?(?:新建|创建)(?:一条)?任务/i.test(q);

  const inquiryHeavy =
    /怎么|如何|怎样|什么是|为何|为什么|是否|介绍|说明|流程|步骤|模板|范例|要求|规范|统计|查询|对比|分析|列出|汇总|检索|有多少|哪些|QF-[A-Z]{2}/i.test(
      q,
    );

  if (!taskNewCue || inquiryHeavy) return router;

  if (
    router.topic !== "task_management" &&
    router.topic !== "general" &&
    router.topic !== "dashboard"
  ) {
    return router;
  }

  return {
    interaction_mode: "operation",
    topic: "task_management",
    topic_rationale: `${router.topic_rationale}（系统规则：识别为手工新建任务类操作意图，已从「询问」纠正为「操作」，须按核心记忆「主要操作描述·手工新建任务」派发 open_task_manual_new。）`,
  };
}

/** 多轮语境下仅在「询问 + topic=general」时延续 history 主题 */
export function applyInquiryTopicHistoryFallback(router: TopicRouterResult, userText: string): TopicRouterResult {
  if (router.interaction_mode !== "inquiry" || router.topic !== "general") return router;
  const inferred = inferTopicFromHistoryMarkdown(getAssistantHistoryForRouter());
  if (
    inferred &&
    (inferred === "report_management" || inferred === "task_management" || inferred === "dashboard") &&
    !intentTopicSwitchedFromPrior(userText, router.topic_rationale, inferred)
  ) {
    const topic: AssistantTopic =
      inferred === "report_management"
        ? "report_management"
        : inferred === "task_management"
          ? "task_management"
          : "dashboard";
    return {
      ...router,
      topic,
      topic_rationale: `${router.topic_rationale}（多轮语境：根据 history.md 中近期主题线索延续为「${topicChineseLabel(topic)}」。）`,
    };
  }
  return router;
}

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
    const interaction_mode = normalizeInteractionMode(o.interaction_mode);
    return { interaction_mode, topic, topic_rationale };
  } catch {
    return null;
  }
}

function normalizeInteractionMode(v: unknown): InteractionMode {
  if (v === "operation" || v === "inquiry") return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "询问") return "inquiry";
    if (s === "操作") return "operation";
  }
  return "inquiry";
}

function normalizeTopic(v: unknown): AssistantTopic {
  if (
    v === "dashboard" ||
    v === "report_management" ||
    v === "task_management" ||
    v === "general"
  ) {
    return v;
  }
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "report" || s.includes("报告")) return "report_management";
    if (s === "task" || s.includes("任务管理")) return "task_management";
    if (
      s.includes("数据看板") ||
      s.includes("销售看板") ||
      s.includes("首页看板") ||
      s === "board" ||
      s.includes("dashboard")
    )
      return "dashboard";
    if (s.includes("综合") || s.includes("general")) return "general";
  }
  return "general";
}

export function topicChineseLabel(topic: AssistantTopic): string {
  switch (topic) {
    case "dashboard":
      return "数据看板";
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
  return `交互类型：${router.interaction_mode}（${router.interaction_mode === "inquiry" ? "询问" : "操作"}）
主题枚举：${router.topic}（${topicChineseLabel(router.topic)}）
判定说明：${router.topic_rationale}`;
}

export function buildOperationConfirmSystemPrompt(): string {
  return resolveOperationConfirmSystemPrompt();
}

export function buildOperationConfirmUserPayload(question: string, topicBlock: string): string {
  return `【主题判断结果】
${topicBlock}

【用户原话】
${question.trim()}`;
}

export function parseOperationConfirmJson(raw: string): OperationConfirmResult | null {
  try {
    const o = JSON.parse(raw.trim()) as Record<string, unknown>;
    const module = normalizeTopic(o.module);
    const operation = typeof o.operation === "string" ? o.operation.trim() : "";
    const user_facing_summary =
      typeof o.user_facing_summary === "string" ? o.user_facing_summary.trim() : "";
    let operation_info: Record<string, unknown> = {};
    const oi = o.operation_info;
    if (oi && typeof oi === "object" && !Array.isArray(oi)) operation_info = oi as Record<string, unknown>;
    if (!operation && !user_facing_summary) return null;
    return {
      module,
      operation: operation || "（未命名操作）",
      operation_info,
      user_facing_summary: user_facing_summary || "（无摘要）",
    };
  } catch {
    return null;
  }
}

export function buildOperationExecuteSystemPrompt(): string {
  return resolveOperationExecuteSystemPrompt();
}

export function buildOperationExecuteUserPayload(
  question: string,
  topicBlock: string,
  confirmJson: string,
): string {
  return `${ASSISTANT_UI_ACTION_TOKENS_HELP}

【主题判断结果】
${topicBlock}

【确认操作及范围 · JSON】
${confirmJson.trim()}

【用户原话】
${question.trim()}`;
}

export function parseOperationExecuteJson(raw: string): OperationExecuteResult | null {
  try {
    const o = JSON.parse(raw.trim()) as Record<string, unknown>;
    const tok = o.ui_action_tokens;
    const rationale = typeof o.rationale === "string" ? o.rationale.trim() : "";
    const ui_action_tokens = Array.isArray(tok)
      ? tok.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)
      : [];
    if (!rationale && ui_action_tokens.length === 0) return null;
    return { ui_action_tokens, rationale: rationale || "（无说明）" };
  } catch {
    return null;
  }
}

/** 解析并派发受控 UI 动作；返回已执行令牌（过滤后） */
export function runAssistantOperationUiActions(rawExecuteJson: string): string[] {
  const parsed = parseOperationExecuteJson(rawExecuteJson);
  const tokens = parsed?.ui_action_tokens ?? [];
  const actions = mapUiActionTokens(tokens);
  if (actions.length) dispatchAssistantUiActions(actions);
  return tokens;
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
  if (/数据看板|销售看板|首页看板/.test(s)) return "dashboard";
  if (/看板|风险|关注|环形|当前视角|总览|逾期|节点/.test(s)) return "general";
  if (/同步|数据中台|清洗|接口/.test(s)) return "general";
  return "general";
}

/** 离线：无模型时粗分询问 / 操作 */
export function inferOfflineInteractionMode(question: string): InteractionMode {
  const s = question.trim();
  if (!s) return "inquiry";
  if (
    /手工新建|新建任务|新建日报|创建任务|去任务管理|去报告|打开任务|打开报告|切换(到)?(任务|报告|看板|首页|数据中台)|跳转(到)?(任务|报告)|进入(任务|报告|看板)|帮我打开|点.*新建/i.test(
      s,
    )
  ) {
    return "operation";
  }
  return "inquiry";
}

export function inferOfflineIntentSummary(question: string): string {
  const s = question.trim();
  if (!s) return "未检测到有效文字，可能是空输入。";
  if (/报告|提取|日报|KPI|产量|提取历史|结构化/.test(s)) {
    return "判断为与「报告管理」或「销售看板 · 报告看板」相关的咨询。";
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
