/**
 * @fileoverview 当前视角（集团领导 /「{架构名}领导」）与任务、报告提取历史的简单权限过滤。
 */

import type { ExtractionHistoryItem } from "../types/extractionHistory";
import type { Task } from "../types/task";
import { getOrgStructureLines } from "./orgStructureStorage";
import { pickBranchCompany } from "./extractionHistoryGroup";

/** 顶部固定项，与部门架构配置项区分 */
export const GROUP_LEADER_PERSPECTIVE = "集团领导";

/**
 * 架构一行（可为「财务部」或「广西分公司.制浆车间」）→ 视角下拉中的选项值。
 * 若行名已以「领导」结尾，则不再追加，避免出现「××领导领导」。
 */
export function perspectiveLabelFromOrgLine(line: string): string {
  const t = line.trim();
  if (!t) return t;
  if (t.endsWith("领导")) return t;
  return `${t}领导`;
}

/** 仅由部门架构配置生成，不自动插入「集团领导」；若架构中含名为「集团领导」的节点，仍会按规则出现在列表中 */
export function buildPerspectiveOptions(orgLines: string[]): string[] {
  return orgLines.map(perspectiveLabelFromOrgLine).filter(Boolean);
}

/**
 * 从架构行或视角单位串中解析「所属分公司」根：点路径时取首个以「分公司」结尾的段；否则整段若为分公司名则返回之。
 */
export function branchRootFromOrgPath(unitOrLine: string): string | null {
  const u = unitOrLine.trim();
  if (!u) return null;
  for (const seg of u.split(".")) {
    const s = seg.trim();
    if (s && isBranchCompanyUnit(s)) return s;
  }
  if (isBranchCompanyUnit(u)) return u;
  return null;
}

/** 执行部门/发起部门是否出现在架构某一行（含点路径末级或任一段） */
export function orgStructureContainsDepartment(orgLines: string[], dept: string): boolean {
  const d = dept.trim();
  if (!d) return false;
  return orgLines.some((line) => {
    const t = line.trim();
    if (t === d) return true;
    if (t.endsWith(`.${d}`)) return true;
    return t.split(".").some((seg) => seg.trim() === d);
  });
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
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of getOrgStructureLines()) {
    const br = branchRootFromOrgPath(line);
    if (br && !seen.has(br)) {
      seen.add(br);
      out.push(br);
    }
  }
  return out;
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
  const branchRoot = branchRootFromOrgPath(unit);
  if (branchRoot !== null) {
    const execBranch = taskExecutionBranchForFilter(task);
    return execBranch === branchRoot;
  }
  const u = unit.trim();
  return (
    task.department.trim() === u ||
    taskInvolvesReceiver(task, u) ||
    (task.executingDepartment?.trim() === u)
  );
}

/** 执行侧是否落在某分公司（分公司领导可见性、看板分公司范围）。 */
export function taskExecutionBranchForFilter(task: Task): string | null {
  const ed = task.executingDepartment?.trim();
  if (ed && isBranchCompanyUnit(ed)) return ed;
  const b = task.branch?.trim();
  if (b && isBranchCompanyUnit(b)) return b;
  return null;
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
  const br = branchRootFromOrgPath(unit);
  if (br !== null) {
    return pickBranchCompany(item).trim() === br;
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
  const br = unit ? branchRootFromOrgPath(unit) : null;
  if (br) return `${br}汇总`;
  return "全部分公司汇总";
}
