export type TaskStatus = "进行中" | "已完成" | "实质性进展";

export type TaskCategory = "安全生产" | "技改项目" | "质量与环保";

export type RiskLevel = "high" | "medium" | "low";

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
  category: TaskCategory;
  /** 任务动因：立项背景、触发原因或政策/事件依据（与「任务描述」区分） */
  taskMotivation: string;
  description: string;
  /** 期待完成：`YYYY-MM-DD`，或无任何明确截止要求时为「待定」 */
  expectedCompletion: string;
  status: TaskStatus;
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
}

/** 当前视角：固定「集团领导」或配置架构行「{名称}领导」 */
export interface CurrentUser {
  perspective: string;
}
