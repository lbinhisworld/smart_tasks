/**
 * @fileoverview 任务管理「计划历史」：日报计划单行生成成功后即追加一条快照（localStorage）。
 */

import type { PendingDailyPlanTaskRow } from "../types/extractionHistory";
import type { PlanHistoryRow, PlanHistoryRowStatus, PlanHistorySnapshot } from "../types/planHistory";

export const PLAN_HISTORY_STORAGE_KEY = "qifeng_plan_history_snapshots_v1";

/** 与 `appendPlanHistorySnapshot` 配对，供任务管理页刷新列表 */
export const PLAN_HISTORY_UPDATED_EVENT = "smart_tasks_plan_history_updated";

const MAX_SNAPSHOTS = 80;

export function loadPlanHistorySnapshots(): PlanHistorySnapshot[] {
  try {
    const raw = localStorage.getItem(PLAN_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as PlanHistorySnapshot[];
  } catch {
    return [];
  }
}

export function appendPlanHistorySnapshot(snapshot: PlanHistorySnapshot): void {
  const prev = loadPlanHistorySnapshots();
  const next = [snapshot, ...prev].slice(0, MAX_SNAPSHOTS);
  localStorage.setItem(PLAN_HISTORY_STORAGE_KEY, JSON.stringify(next));
}

/** 单行日报计划生成任务成功后立即写入一条计划历史（单列表格一条） */
export function appendDailyPlanRowToPlanHistory(args: {
  row: PendingDailyPlanTaskRow;
  leaderInstructionSnapshot: string;
  perspective: string;
}): void {
  const formedOn = todayLocalIsoDate();
  const planRow: PlanHistoryRow = {
    ...args.row,
    leaderInstructionSnapshot: args.leaderInstructionSnapshot.trim(),
    taskFormedOn: formedOn,
    planRolePerspective: args.perspective.trim(),
    planRowStatus: "已有任务",
  };
  const snapshot: PlanHistorySnapshot = {
    id: `ph_${Date.now()}_${args.row.id}`,
    createdAt: new Date().toISOString(),
    perspectiveWhenSaved: args.perspective.trim(),
    rows: [planRow],
  };
  appendPlanHistorySnapshot(snapshot);
  window.dispatchEvent(new CustomEvent(PLAN_HISTORY_UPDATED_EVENT, { bubbles: true }));
}

/** 展示用：旧数据无字段时视为「已有任务」 */
export function planHistoryStatusLabel(row: PlanHistoryRow): PlanHistoryRowStatus {
  return row.planRowStatus === "待计划" ? "待计划" : "已有任务";
}

/** 处于「待计划」的日报计划行 id（用于看板隐藏「生成任务」直至「返回计划」） */
export function loadPendingPlanDailyPlanRowIds(): Set<string> {
  const s = new Set<string>();
  for (const snap of loadPlanHistorySnapshots()) {
    for (const row of snap.rows) {
      if (row.planRowStatus === "待计划") s.add(row.id);
    }
  }
  return s;
}

function persistPlanHistorySnapshots(next: PlanHistorySnapshot[]): void {
  localStorage.setItem(PLAN_HISTORY_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(PLAN_HISTORY_UPDATED_EVENT, { bubbles: true }));
}

/**
 * 删除任务且任务来自日报计划行时调用：将所有快照中该计划行标为「待计划」（看板不再直接出现「生成任务」）。
 */
export function markPlanHistoryRowsPendingPlan(pendingDailyPlanRowId: string): void {
  const rid = pendingDailyPlanRowId.trim();
  if (!rid) return;
  const snaps = loadPlanHistorySnapshots();
  let changed = false;
  const next = snaps.map((snap) => ({
    ...snap,
    rows: snap.rows.map((row) => {
      if (row.id !== rid) return row;
      if (row.planRowStatus === "待计划") return row;
      changed = true;
      return { ...row, planRowStatus: "待计划" as const };
    }),
  }));
  if (!changed) return;
  persistPlanHistorySnapshots(next);
}

function snapshotsWithPendingPlanRowsRemoved(
  snaps: PlanHistorySnapshot[],
  pendingRowIds: Set<string>,
): { next: PlanHistorySnapshot[]; changed: boolean } {
  let changed = false;
  const next: PlanHistorySnapshot[] = [];
  for (const snap of snaps) {
    const newRows = snap.rows.filter(
      (row) => !(row.planRowStatus === "待计划" && pendingRowIds.has(row.id.trim())),
    );
    if (newRows.length !== snap.rows.length) changed = true;
    if (newRows.length > 0) {
      next.push(newRows.length === snap.rows.length ? snap : { ...snap, rows: newRows });
    }
  }
  return { next, changed };
}

/**
 * 「返回计划」：从计划历史中删除该条「待计划」记录（看板对应行恢复「生成任务」）。
 * 若某快照在删除后无行，则整段快照一并移除。
 */
export function restorePlanHistoryRowFromPendingPlan(pendingDailyPlanRowId: string): void {
  const rid = pendingDailyPlanRowId.trim();
  if (!rid) return;
  const { next, changed } = snapshotsWithPendingPlanRowsRemoved(loadPlanHistorySnapshots(), new Set([rid]));
  if (!changed) return;
  persistPlanHistorySnapshots(next);
}

/** 批量「返回计划」：按日报计划行 id 移除所有快照中对应「待计划」行（一次持久化）。 */
export function restorePlanHistoryRowsFromPendingPlanBatch(pendingDailyPlanRowIds: string[]): void {
  const idSet = new Set(pendingDailyPlanRowIds.map((x) => x.trim()).filter(Boolean));
  if (!idSet.size) return;
  const { next, changed } = snapshotsWithPendingPlanRowsRemoved(loadPlanHistorySnapshots(), idSet);
  if (!changed) return;
  persistPlanHistorySnapshots(next);
}

export function todayLocalIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
