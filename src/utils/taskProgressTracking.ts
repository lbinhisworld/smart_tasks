/**
 * @fileoverview 任务「进度跟踪」子表：追加一条进展（报告页现有任务进度更新写入）。
 */

import type { TaskProgressEntry } from "../types/task";

/** 将「进度更新」正文与日报日期追加到任务时间线；空或「暂无」不写入。 */
export function appendTaskProgressEntry(
  existing: TaskProgressEntry[] | undefined,
  reportDateIso: string,
  progressDescription: string,
): TaskProgressEntry[] {
  const prev = existing?.length ? [...existing] : [];
  const desc = progressDescription.trim();
  if (!desc || desc === "暂无") return prev;
  const d = reportDateIso.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return prev;
  return [...prev, { date: d, description: desc }];
}
