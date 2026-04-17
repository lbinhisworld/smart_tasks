/**
 * @fileoverview 从「日报计划提取任务」一行 + 领导指示调用大模型，合成任务动因并抽取任务字段，供写入任务列表。
 */

import type { PendingDailyPlanTaskRow } from "../types/extractionHistory";
import type { Task, TaskCategory } from "../types/task";
import { callLlmChatJsonObject, parseJsonSafe, readLlmEnv } from "./llmExtract";
import { normalizeExpectedCompletion } from "./taskDueDate";
import { GROUP_LEADER_PERSPECTIVE, isBranchCompanyUnit } from "./leaderPerspective";

const TASK_FROM_PLAN_SYSTEM = `你是造纸企业集团的「任务交办」助手。用户会提供一条从日报协调事项提取的结构化数据（JSON）及可选的领导指示。
你必须只输出一个 JSON 对象，不要 markdown，不要解释。键名必须严格使用下列英文 camelCase（不得改用中文键名）：
- taskMotivation（string）：将发起部门、发起日期、请求描述、领导指示（可为空）综合为 1～3 句连贯中文，体现背景、协调诉求与领导要求（如截止日、协办方）。
- department（string）：任务发起部门，与输入 initiatingDepartment 对齐，可略作规范化。
- executingDepartment（string）：任务主要落地执行单位（分公司名或「XX部」等）。
- description（string）：承办人可执行的任务说明，含交付要点或步骤，避免与 taskMotivation 完全重复堆砌。
- expectedCompletion（string）：仅当「领导指示」或「请求描述」中出现明确、可执行的截止要求（具体日期，或可唯一换算为日历日的表述，且你将在 taskMotivation/description 中写出同一截止信息）时，输出严格 YYYY-MM-DD；**若两处均未出现任何明确截止要求，必须输出字面「待定」**，禁止根据发起日期自行加天数猜测。
- category（string）：只能是 安全生产、技改项目、质量与环保 之一。
- initiator（string）：可选；客户端会按当前领导视角统一写入交办人，模型可省略或填占位。
- receiverDepartments（string[]）：需配合的部门名称列表，无则输出空数组 []。`;

function branchWorkshopFromExecuting(executingDepartment: string): { branch: string; workshop: null } {
  const ed = executingDepartment.trim();
  if (ed && isBranchCompanyUnit(ed)) return { branch: ed, workshop: null };
  return { branch: "", workshop: null };
}

function coerceCategory(s: string): TaskCategory {
  const t = s.trim();
  if (t === "安全生产" || t === "技改项目" || t === "质量与环保") return t;
  return "安全生产";
}

function pickStr(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function parseReceivers(v: unknown): string[] | undefined {
  if (Array.isArray(v)) {
    const out = v
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
    return out.length ? out : undefined;
  }
  if (typeof v === "string" && v.trim()) {
    const parts = v
      .split(/[,，、;；\n]/)
      .map((x) => x.trim())
      .filter(Boolean);
    return parts.length ? parts : undefined;
  }
  return undefined;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** 与看板视角一致：「集团领导」→ 集团领导交办；「广西分公司领导」→ 广西分公司领导交办 */
function initiatorFromPlanPerspective(perspective: string): string {
  const p = perspective.trim();
  if (!p || p === GROUP_LEADER_PERSPECTIVE) return "集团领导交办";
  return `${p}交办`;
}

/**
 * 调用大模型，将日报计划提取行与领导指示转为可 `addTask` 的任务字段（不含 id / code / createdAt）。
 */
export async function generateTaskInputFromDailyPlanRow(args: {
  row: PendingDailyPlanTaskRow;
  leaderInstruction: string;
  /** 看板当前领导视角（如「集团领导」「广西分公司领导」），决定发起人及分公司任务 branch 归属 */
  planPerspective: string;
}): Promise<Omit<Task, "id" | "code" | "createdAt">> {
  const env = readLlmEnv();
  if (!env) {
    throw new Error("未配置大模型：请在应用内配置 DeepSeek API Key，或配置 VITE_LLM_* / 开发代理后再试。");
  }

  const { row, leaderInstruction, planPerspective } = args;
  const payload = {
    initiatingDepartment: row.initiatingDepartment,
    executingDepartmentHint: row.executingDepartment,
    reportDate: row.reportDate,
    requestDescription: row.requestDescription.replace(/\s+/g, " ").trim(),
    leaderInstruction: leaderInstruction.replace(/\s+/g, " ").trim(),
  };

  const userMsg = `请根据以下输入生成任务 JSON：\n${JSON.stringify(payload, null, 2)}`;

  const res = await callLlmChatJsonObject(env, TASK_FROM_PLAN_SYSTEM, userMsg);
  let root: unknown;
  try {
    root = parseJsonSafe(res.content);
  } catch {
    throw new Error("模型返回内容不是合法 JSON。");
  }

  const o = asRecord(root);
  if (!o) throw new Error("模型返回 JSON 根须为对象。");

  const taskMotivation = pickStr(o, "taskMotivation", "任务动因");
  const department = pickStr(o, "department", "发起部门") || row.initiatingDepartment.trim();
  const executingDepartment =
    pickStr(o, "executingDepartment", "执行部门") || row.executingDepartment.trim() || department;
  let description = pickStr(o, "description", "任务描述") || row.requestDescription.trim();
  const expectedCompletion = normalizeExpectedCompletion(pickStr(o, "expectedCompletion", "期待完成日期"));
  const category = coerceCategory(pickStr(o, "category", "任务类别"));
  const initiator = initiatorFromPlanPerspective(planPerspective);
  const receiverDepartments = parseReceivers(o.receiverDepartments ?? o["接收配合部门"]);

  if (!taskMotivation) {
    throw new Error("模型未返回 taskMotivation（任务动因），请重试或简化领导指示后重试。");
  }

  let { branch, workshop } = branchWorkshopFromExecuting(executingDepartment);
  /** 执行部门为职能部但发起方为分公司时，仍归到该分公司，分公司领导可见 */
  if (!branch) {
    const d = department.trim();
    if (isBranchCompanyUnit(d)) branch = d;
    else if (isBranchCompanyUnit(row.initiatingDepartment.trim())) branch = row.initiatingDepartment.trim();
  }

  const out: Omit<Task, "id" | "code" | "createdAt"> = {
    initiator,
    department,
    executingDepartment,
    category,
    taskMotivation,
    description,
    expectedCompletion,
    status: "进行中",
    branch,
    workshop,
    ...(receiverDepartments?.length ? { receiverDepartments } : {}),
  };

  return out;
}
