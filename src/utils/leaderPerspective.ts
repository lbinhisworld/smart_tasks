/**
 * @fileoverview 当前视角（集团领导 /「{架构名}领导」）与任务、报告提取历史的简单权限过滤。
 */

import type { ExtractionHistoryItem } from "../types/extractionHistory";
import type { Task } from "../types/task";
import { getOrgStructureLines } from "./orgStructureStorage";
import { pickBranchCompany } from "./extractionHistoryGroup";

/** 顶部固定项，与部门架构配置项区分 */
export const GROUP_LEADER_PERSPECTIVE = "集团领导";

export function buildPerspectiveOptions(orgLines: string[]): string[] {
  return [GROUP_LEADER_PERSPECTIVE, ...orgLines.map((line) => `${line}领导`)];
}

/** 从「财务部领导」得到「财务部」；集团领导返回 null */
export function orgUnitFromPerspective(perspective: string): string | null {
  if (perspective === GROUP_LEADER_PERSPECTIVE) return null;
  if (perspective.endsWith("领导")) return perspective.slice(0, -"领导".length);
  return perspective;
}

export function isBranchCompanyUnit(unit: string): boolean {
  return /分公司\s*$/.test(unit.trim());
}

export function getBranchCompanyNamesFromOrg(): string[] {
  return getOrgStructureLines().filter((l) => isBranchCompanyUnit(l));
}

function taskInvolvesReceiver(task: Task, unit: string): boolean {
  const rs = task.receiverDepartments;
  if (rs?.length) return rs.some((r) => r.trim() === unit);
  const one = task.receiverDepartment?.trim();
  return Boolean(one && one === unit);
}

/**
 * 任务：集团领导看全部；部门领导看本部门发起或接收；分公司领导看本分公司及下属车间（即 branch 匹配）。
 */
export function taskVisibleForPerspective(task: Task, perspective: string): boolean {
  if (perspective === GROUP_LEADER_PERSPECTIVE) return true;
  const unit = orgUnitFromPerspective(perspective);
  if (!unit) return true;
  if (isBranchCompanyUnit(unit)) {
    return task.branch.trim() === unit.trim();
  }
  return task.department.trim() === unit.trim() || taskInvolvesReceiver(task, unit.trim());
}

/**
 * 报告提取历史：集团领导、非分公司职能部门领导看全部；分公司领导仅看本公司数据。
 */
export function extractionHistoryVisibleForPerspective(
  item: ExtractionHistoryItem,
  perspective: string,
): boolean {
  if (perspective === GROUP_LEADER_PERSPECTIVE) return true;
  const unit = orgUnitFromPerspective(perspective);
  if (!unit) return true;
  if (isBranchCompanyUnit(unit)) {
    return pickBranchCompany(item).trim() === unit.trim();
  }
  return true;
}

/**
 * 报告看板「当日产量指标」一级卡片括号内说明：与当前视角下传入的历史数据范围一致。
 * 分公司领导为「{分公司名}汇总」；集团领导与可看全量报告数据的职能部门领导为「全部分公司汇总」。
 */
export function reportDashboardLevel1ScopeLabel(perspective: string): string {
  if (perspective === GROUP_LEADER_PERSPECTIVE) return "全部分公司汇总";
  const unit = orgUnitFromPerspective(perspective);
  if (unit && isBranchCompanyUnit(unit)) return `${unit.trim()}汇总`;
  return "全部分公司汇总";
}
