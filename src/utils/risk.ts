import type { RiskLevel, Task } from "../types/task";
import { isIsoDateString } from "./taskDueDate";

export function riskForTask(task: Task, today = new Date()): RiskLevel {
  if (task.status === "已完成") return "low";
  if (!isIsoDateString(task.expectedCompletion)) return "low";
  const due = new Date(task.expectedCompletion);
  const t = today.getTime();
  if (due.getTime() < t) return "high";
  const week = 7 * 24 * 60 * 60 * 1000;
  if (due.getTime() - t <= week) return "medium";
  return "low";
}

export function riskLabel(level: RiskLevel): string {
  if (level === "high") return "红灯";
  if (level === "medium") return "黄灯";
  return "蓝灯";
}
