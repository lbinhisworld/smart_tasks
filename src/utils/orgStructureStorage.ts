/**
 * @fileoverview 齐峰集团部门/分公司架构：用户可编辑的多行文本，持久化于 localStorage。
 */

const STORAGE_KEY = "qifeng_org_structure_v1";

export const ORG_STRUCTURE_CHANGED_EVENT = "qifeng-org-structure-changed";

/** 初始展示的集团架构（每行一条） */
export const DEFAULT_ORG_STRUCTURE_TEXT = `财务部
审计部
销售部
行政部
技术部
采购部
设备部
安环部
广西分公司
华林分公司
欧华分公司
欧木分公司
卫材分公司`;

export function getOrgStructureText(): string {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s !== null) return s;
  } catch {
    /* ignore */
  }
  return DEFAULT_ORG_STRUCTURE_TEXT;
}

export function setOrgStructureText(text: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, text);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(ORG_STRUCTURE_CHANGED_EVENT));
}

/** 非空行列表（用于角色视角下拉等） */
export function getOrgStructureLines(): string[] {
  return getOrgStructureText()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}
