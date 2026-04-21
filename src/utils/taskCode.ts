/**
 * @fileoverview 任务自动编号：QF-发起部门拼音2位首字母-大类三位字母-四位流水号。
 */

import { pinyin } from "pinyin-pro";
import { taskCategoryLevel1Code3 } from "../data/taskCategories";
import type { Task } from "../types/task";

const AUTO_CODE_RE = /^QF-[A-Z]{2}-[A-Z]{3}-\d{4}$/;

const DEPT_SUFFIX_RE =
  /(?:部|分公司|有限公司|公司|集团|领导|车间|处|室|厂|中心|小组)$/u;

/** 去掉常见组织后缀后，取前两个汉字的拼音首字母（大写）；纯英文部门取前两个字母 */
export function departmentPinyinInitials2(department: string): string {
  const raw = department.trim().replace(/\s+/g, "");
  if (!raw) return "NA";

  const latinAll = raw.replace(/[^A-Za-z]/g, "").toUpperCase();
  if (latinAll.length >= 2) return latinAll.slice(0, 2);
  if (latinAll.length === 1) return `${latinAll}X`;

  const core = raw.replace(DEPT_SUFFIX_RE, "") || raw;
  const hanziChars = [...core].filter((ch) => /\p{Script=Han}/u.test(ch));
  const twoHan = (hanziChars.length >= 2 ? hanziChars.slice(0, 2) : hanziChars).join("");
  if (!twoHan) {
    return "NA";
  }

  const arr = pinyin(twoHan, {
    pattern: "first",
    type: "array",
    toneType: "none",
  }) as string[];
  const initials = arr
    .map((x) => String(x).charAt(0).toUpperCase())
    .join("")
    .replace(/[^A-Z]/g, "");
  if (initials.length >= 2) return initials.slice(0, 2);
  if (initials.length === 1) return `${initials}X`;
  return "NA";
}

/** 下一个四位流水号（仅统计符合新规则的编号，避免与旧格式混用冲突） */
export function nextTaskCodeSerial(tasks: Task[]): number {
  let max = 0;
  for (const t of tasks) {
    const m = AUTO_CODE_RE.exec(t.code.trim());
    if (m) {
      max = Math.max(max, parseInt(t.code.trim().slice(-4), 10));
    }
  }
  return max + 1;
}

/** 按发起部门 + 任务大类生成自动编号（不含手动传入的 code） */
export function buildAutoTaskCode(department: string, categoryLevel1: string, tasks: Task[]): string {
  const dept = departmentPinyinInitials2(department);
  const cat = taskCategoryLevel1Code3(categoryLevel1);
  const n = nextTaskCodeSerial(tasks);
  return `QF-${dept}-${cat}-${String(n).padStart(4, "0")}`;
}
