/**
 * @fileoverview 判断任务是否归属某分公司（与报告里的「所属分公司 / 分公司名称」对齐）。
 */

import type { Task } from "../types/task";
import { taskExecutionBranchForFilter } from "./leaderPerspective";
import { normalizeReportCompanyName } from "./reportCompanyDailySlices";

export function taskMatchesReportCompany(task: Task, reportCompanyName: string): boolean {
  const c = normalizeReportCompanyName(reportCompanyName);
  if (!c) return false;
  const ex = taskExecutionBranchForFilter(task);
  if (ex && ex === c) return true;
  const br = task.branch?.trim();
  if (br && normalizeReportCompanyName(br) === c) return true;
  const ed = task.executingDepartment?.trim();
  if (ed && normalizeReportCompanyName(ed) === c) return true;
  return false;
}
