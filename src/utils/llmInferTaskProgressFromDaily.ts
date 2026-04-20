/**
 * @fileoverview 从分公司日报正文中推断单项任务的进度摘要与状态建议（JSON）。
 */

import type { Task, TaskStatus } from "../types/task";
import { callLlmChatJsonObject, type LlmEnv } from "./llmExtract";

const MAX_DAILY = 28_000;

const SYSTEM = `你是企业任务管理助手。给定「分公司日报摘录」与「一项待跟进任务」，判断日报是否涉及该任务。

只输出一个 JSON 对象，键为：
- progress_line：字符串，「进度」一句话；无相关信息填「暂无」
- difficulty_line：字符串，「困难 / 风险」一句话；无则填「暂无」
- status_hint：字符串，仅可为 "unchanged" | "substantive" | "completed"
  - completed：日报能明确推断该任务已办结、验收、目标已达成等
  - substantive：有明确新进展但未体现任务已结束
  - unchanged：未提及该任务或无法对应到任务实质内容

不要输出 markdown 或其它键。`;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export type TaskProgressStatusHint = "unchanged" | "substantive" | "completed";

export interface TaskProgressInference {
  progressBlock: string;
  statusSuggestion: TaskStatus | null;
  rawHint: TaskProgressStatusHint;
}

function mapHintToStatus(
  hint: TaskProgressStatusHint,
  current: TaskStatus,
): TaskStatus | null {
  if (hint === "unchanged") return null;
  if (hint === "substantive") {
    if (current === "已完成") return null;
    return "实质性进展";
  }
  if (hint === "completed") return "已完成";
  return null;
}

export async function inferTaskProgressFromDaily(
  env: LlmEnv,
  dailyPlainText: string,
  task: Task,
): Promise<TaskProgressInference> {
  const body =
    dailyPlainText.length > MAX_DAILY ? dailyPlainText.slice(0, MAX_DAILY) : dailyPlainText;
  const user = `【分公司日报（节选）】
${body}

【任务编号】${task.code}
【任务名称 / 描述】${task.description}
【任务动因】${task.taskMotivation || "暂无"}
【任务当前状态】${task.status}
【任务类别】${task.category}`;

  const res = await callLlmChatJsonObject(env, SYSTEM, user);
  let root: unknown;
  try {
    root = JSON.parse(res.content.trim());
  } catch {
    return {
      progressBlock: "1）进度：解析失败；2）困难：暂无",
      statusSuggestion: null,
      rawHint: "unchanged",
    };
  }
  if (!isRecord(root)) {
    return {
      progressBlock: "1）进度：解析失败；2）困难：暂无",
      statusSuggestion: null,
      rawHint: "unchanged",
    };
  }
  const pl = root.progress_line;
  const dl = root.difficulty_line;
  const sh = root.status_hint;
  const progressLine = typeof pl === "string" ? pl.trim() || "暂无" : "暂无";
  const diffLine = typeof dl === "string" ? dl.trim() || "暂无" : "暂无";
  const progressBlock = `1）进度：${progressLine}；2）困难：${diffLine}`;
  let rawHint: TaskProgressStatusHint = "unchanged";
  if (sh === "substantive" || sh === "completed" || sh === "unchanged") {
    rawHint = sh;
  }
  const statusSuggestion = mapHintToStatus(rawHint, task.status);
  return { progressBlock, statusSuggestion, rawHint };
}
