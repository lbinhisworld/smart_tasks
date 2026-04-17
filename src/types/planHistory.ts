import type { PendingDailyPlanTaskRow } from "./extractionHistory";

/** 计划历史行状态：删除关联任务后为待计划；点击「返回计划」后该条从计划历史移除（看板可再次生成） */
export type PlanHistoryRowStatus = "待计划" | "已有任务";

/** 计划历史表中的一行：日报计划字段 + 写入时补记的两列 */
export interface PlanHistoryRow extends PendingDailyPlanTaskRow {
  /** 领导指示/建议（写入计划历史时的文本快照） */
  leaderInstructionSnapshot: string;
  /** 任务形成日期：写入计划历史的操作日 YYYY-MM-DD（本地日历日） */
  taskFormedOn: string;
  /** 任务计划角色：写入时的当前领导视角（如「集团领导」） */
  planRolePerspective: string;
  /**
   * 与任务列表删除联动：删除由该行生成的任务后标为「待计划」；「返回计划」后从计划历史中删除该条记录。
   * 旧数据缺省按「已有任务」理解。
   */
  planRowStatus?: PlanHistoryRowStatus;
}

/** 一次「批量生成」正常结束后的整表快照 */
export interface PlanHistorySnapshot {
  id: string;
  /** 写入时间 ISO */
  createdAt: string;
  /** 写入时的视角（与各行 planRolePerspective 一致） */
  perspectiveWhenSaved: string;
  rows: PlanHistoryRow[];
}
