/**
 * 进行中 / 已完成 / 实质性进展 / 卡住待协调 为用户或模型直接状态；
 * 「已超时」由期待完成日早于今日且非终态时由 `reconcileTaskStatusByDueDate` 归并。
 */
export type TaskStatus = "进行中" | "已完成" | "已超时" | "实质性进展" | "卡住待协调";

/** 任务处于「卡住待协调」时的协调方（必选其一） */
export const COORDINATION_PARTY_OPTIONS = ["集团公司", "各职能部门", "分公司领导"] as const;

export type CoordinationPartyOption = (typeof COORDINATION_PARTY_OPTIONS)[number];

/**
 * 将任意来源的状态字段规范为 {@link TaskStatus}。
 * @param v 原始值
 */
export function normalizeTaskStatusField(v: unknown): TaskStatus {
  if (
    v === "进行中" ||
    v === "已完成" ||
    v === "已超时" ||
    v === "实质性进展" ||
    v === "卡住待协调"
  ) {
    return v;
  }
  return "进行中";
}

export type RiskLevel = "high" | "medium" | "low";

/** 任务写入企业微信智能表格 Webhook 后的同步状态 */
export type SmartsheetPushStatus = "success" | "failed";

/** 单条进展：日期 + 描述（如来自日报「进度更新」） */
export interface TaskProgressEntry {
  /** YYYY-MM-DD */
  date: string;
  description: string;
}

export interface Task {
  id: string;
  code: string;
  initiator: string;
  /** 发起部门（与当前视角对应；集团视角下可任选架构中的部门/分公司） */
  department: string;
  /** 执行部门：任务落地组织，须为架构中的职能部门或分公司（集团视角下可填任意非空名称） */
  executingDepartment: string;
  /** 任务大类（与 `src/data/taskCategories.ts` 中 level_1 一致） */
  categoryLevel1: string;
  /** 任务子类（与对应大类下 level_2[].name 一致） */
  categoryLevel2: string;
  /** 任务动因：立项背景、触发原因或政策/事件依据（与「任务描述」区分） */
  taskMotivation: string;
  description: string;
  /**
   * 领导指示 / 建议原文或快照：来自日报计划「领导指示/建议」写入，或由日报进度推断在正文中明确对应本任务的指示。
   */
  leaderInstruction?: string;
  /** 期待完成：`YYYY-MM-DD`，或无任何明确截止要求时为「待定」 */
  expectedCompletion: string;
  status: TaskStatus;
  /**
   * 协调方：仅当 `status === "卡住待协调"` 时有效，须为 {@link COORDINATION_PARTY_OPTIONS} 之一。
   */
  coordinationParty?: string;
  /** 当执行部门为分公司时与之一致；职能部门执行时为「」 */
  branch: string;
  /** 历史兼容：新建任务不再填写车间，保留字段供旧数据与看板车间范围筛选 */
  workshop: string | null;
  createdAt: string;
  followedByUser?: boolean;
  /** 接收 / 配合部门（可多值），用于部门领导「接收方」可见权限 */
  receiverDepartments?: string[];
  /** 单接收部门，兼容旧数据 */
  receiverDepartment?: string;
  /** 看板「日报计划提取任务」行 id（`PendingDailyPlanTaskRow.id`）；写入后用于跨页展示已生成任务编号 */
  sourcePendingDailyPlanRowId?: string;
  /** 进度跟踪：按保存顺序排列的时间线（展示时可按日期排序） */
  progressTracking?: TaskProgressEntry[];
  /** 最近一次智能表格 Webhook 推送是否成功（未配置 Webhook 时不写入该字段） */
  smartsheetPushStatus?: SmartsheetPushStatus;
  /** 最近一次推送失败时的简要原因，供操作列「重推」提示 */
  smartsheetPushError?: string;
}

/** 当前视角：固定「集团领导」或配置架构行「{名称}领导」 */
export interface CurrentUser {
  perspective: string;
}
