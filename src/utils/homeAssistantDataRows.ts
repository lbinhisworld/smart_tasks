/**
 * @fileoverview AI 助手第四步：按任务编号 / 提取历史 id 从本机数据集中解析行并序列化为 JSON。
 */

import type { ExtractionHistoryItem } from "../types/extractionHistory";
import type { Task } from "../types/task";
import { pickBranchCompany, pickExtractionDate } from "./extractionHistoryGroup";

const MAX_TASK_ROWS = 48;
const MAX_REPORT_ROWS = 24;
const REPORT_TEXT_PREVIEW = 1200;

export function normalizeTaskCode(c: string): string {
  return c.trim().toUpperCase();
}

/** 按编号匹配本机任务（大小写不敏感） */
export function pickTasksByCodes(allTasks: Task[], codes: string[]): Task[] {
  const want = new Set(codes.map(normalizeTaskCode).filter(Boolean));
  if (want.size === 0) return [];
  return allTasks.filter((t) => want.has(normalizeTaskCode(t.code ?? "")));
}

export function pickHistoryByIds(all: ExtractionHistoryItem[], ids: string[]): ExtractionHistoryItem[] {
  const want = new Set(ids.map((x) => x.trim()).filter(Boolean));
  if (want.size === 0) return [];
  return all.filter((h) => want.has(h.id));
}

export function tasksToLlmRows(tasks: Task[]): Record<string, unknown>[] {
  const slice = tasks.slice(0, MAX_TASK_ROWS);
  return slice.map((t) => ({
    type: "task",
    id: t.id,
    任务编号: t.code,
    发起人: t.initiator,
    发起部门: t.department,
    执行部门: t.executingDepartment,
    大类: t.categoryLevel1,
    子类: t.categoryLevel2,
    期待完成: t.expectedCompletion,
    状态: t.status,
    任务描述: t.description?.slice(0, 500) ?? "",
    任务动因: (t.taskMotivation ?? "").slice(0, 300),
  }));
}

export function extractionItemsToLlmRows(items: ExtractionHistoryItem[]): Record<string, unknown>[] {
  const slice = items.slice(0, MAX_REPORT_ROWS);
  return slice.map((h) => ({
    type: "extraction_history",
    id: h.id,
    提取日期: pickExtractionDate(h),
    分公司: pickBranchCompany(h),
    文件名: h.fileName,
    正文节选: (h.originalText ?? "").slice(0, REPORT_TEXT_PREVIEW),
  }));
}
