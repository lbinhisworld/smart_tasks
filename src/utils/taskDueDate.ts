import type { Task, TaskStatus } from "../types/task";

/** 无明确截止要求时的期待完成占位（与任务列表、表单一致） */
export const PENDING_EXPECTED_COMPLETION = "待定";

export function isIsoDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

/**
 * 本地日历日 `YYYY-MM-DD`（按用户本机时区）。
 */
export function todayIsoDateLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 明天日期 `YYYY-MM-DD`（新建任务期待完成默认值）。
 */
export function tomorrowIsoDateLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 根据期待完成日将任务状态归并为「已超时」或从「已超时」恢复为「进行中」；`已完成` 不变。
 * 用于读库、保存后统一口径（与列表、推送一致）。
 */
export function reconcileTaskStatusByDueDate(t: Task): Task {
  if (t.status === "已完成") return t;
  const due = t.expectedCompletion?.trim() ?? "";
  const isPending = !due || due === PENDING_EXPECTED_COMPLETION;
  if (!isIsoDateString(due) || isPending) {
    if (t.status === "已超时") return { ...t, status: "进行中" };
    return t;
  }
  const today = todayIsoDateLocal();
  if (due < today) {
    return { ...t, status: "已超时" as TaskStatus };
  }
  if (t.status === "已超时") return { ...t, status: "进行中" };
  return t;
}

/** 将模型或其它来源的期待完成字段规范为 YYYY-MM-DD 或「待定」 */
export function normalizeExpectedCompletion(raw: string): string {
  const t = raw.trim();
  if (!t) return PENDING_EXPECTED_COMPLETION;
  if (t === PENDING_EXPECTED_COMPLETION || t === "TBD" || t === "待确定") return PENDING_EXPECTED_COMPLETION;
  if (isIsoDateString(t)) return t;
  return PENDING_EXPECTED_COMPLETION;
}
