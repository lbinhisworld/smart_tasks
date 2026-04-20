import type { TaskStatus } from "../types/task";

const STATUS_PILL_CLASS: Record<TaskStatus, string> = {
  已完成: "task-status-pill task-status-pill--done",
  卡住待协调: "task-status-pill task-status-pill--stuck",
  进行中: "task-status-pill task-status-pill--ongoing",
  实质性进展: "task-status-pill task-status-pill--solid",
};

/** 任务详情抽屉标题栏修饰类（与 {@link TaskStatusPill} 配色一致） */
const DETAIL_TOOLBAR_MODIFIER: Record<TaskStatus, string> = {
  已完成: "task-detail-drawer-toolbar--done",
  卡住待协调: "task-detail-drawer-toolbar--stuck",
  进行中: "task-detail-drawer-toolbar--ongoing",
  实质性进展: "task-detail-drawer-toolbar--solid",
};

export function taskDetailDrawerToolbarModifierClass(status: TaskStatus): string {
  return DETAIL_TOOLBAR_MODIFIER[status];
}

/** 任务状态彩色标签（只读展示） */
export function TaskStatusPill({ status }: { status: TaskStatus }) {
  return <span className={STATUS_PILL_CLASS[status]}>{status}</span>;
}
