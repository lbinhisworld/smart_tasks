export type TaskStatus = "进行中" | "已完成" | "实质性进展";

export type TaskCategory = "安全生产" | "技改项目" | "质量与环保";

export type RiskLevel = "high" | "medium" | "low";

export type UserRole = "chairman" | "functional" | "branch" | "workshop";

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
}

export interface CurrentUser {
  role: UserRole;
  /** 职能部门人员所属部门名，用于过滤 */
  department?: string;
  /** 分公司负责人所属分公司 */
  branch?: string;
  /** 车间负责人所属车间 */
  workshop?: string;
}
