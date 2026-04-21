/**
 * @fileoverview 任务动态记忆：全量任务摘要写入 localStorage，供 AI 助手 system 注入；任务列表变更时同步更新。
 */

import type { Task } from "../types/task";

const STORAGE_KEY = "qifeng_ai_task_dynamic_memory_v1";

/** 表头与字段顺序固定，便于模型解析 */
function formatTasksAsText(tasks: Task[]): string {
  if (tasks.length === 0) return "（当前无任务记录）\n";
  const lines = [
    "任务编号\t发起人\t发起部门\t执行部门\t大类\t子类\t期待完成\t状态",
    ...tasks.map((t) =>
      [
        t.code ?? "",
        t.initiator ?? "",
        t.department ?? "",
        t.executingDepartment ?? "",
        t.categoryLevel1 ?? "",
        t.categoryLevel2 ?? "",
        t.expectedCompletion ?? "",
        t.status ?? "",
      ]
        .map((cell) => String(cell).replace(/\t/g, " ").replace(/\n/g, " "))
        .join("\t"),
    ),
  ];
  return `${lines.join("\n")}\n共 ${tasks.length} 条。\n`;
}

/** 任务增删改后调用，持久化摘要文本 */
export function syncTaskDynamicMemoryFromTasks(tasks: Task[]): void {
  try {
    const text = formatTasksAsText(tasks);
    localStorage.setItem(STORAGE_KEY, text);
  } catch {
    /* ignore quota */
  }
}

/** 供构建大模型 system 提示时读取 */
export function loadTaskDynamicMemoryText(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw?.trim()) return raw.trim();
  } catch {
    /* ignore */
  }
  return "（尚未生成任务动态记忆，请稍候或检查本地存储。）";
}
