export type TaskStatus = "进行中" | "已完成" | "实质性进展";

export type TaskCategory = "安全生产" | "技改项目" | "质量与环保";

export type RiskLevel = "high" | "medium" | "low";

export interface Task {
  id: string;
  code: string;
  initiator: string;
  department: string;
  category: TaskCategory;
  description: string;
  expectedCompletion: string;
  status: TaskStatus;
  branch: string;
  workshop: string | null;
  createdAt: string;
  followedByUser?: boolean;
  /** 接收 / 配合部门（可多值），用于部门领导「接收方」可见权限 */
  receiverDepartments?: string[];
  /** 单接收部门，兼容旧数据 */
  receiverDepartment?: string;
}

/** 当前视角：固定「集团领导」或配置架构行「{名称}领导」 */
export interface CurrentUser {
  perspective: string;
}
