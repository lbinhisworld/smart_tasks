/**
 * @fileoverview 日报动态记忆：从提取历史生成「日期、分公司、约200字摘要、关联任务编号」列表，持久化供 AI 助手注入；提取历史增删改后全量重建。
 */

import type { ExtractionHistoryItem } from "../types/extractionHistory";
import { pickBranchCompany, pickExtractionDate } from "./extractionHistoryGroup";

const STORAGE_KEY = "qifeng_ai_report_dynamic_memory_v1";

const TASK_CODE_RE = /QF-[A-Z]{2}-[A-Z]{3}-\d{4}/g;

export interface ReportDynamicMemoryEntry {
  extractionHistoryId: string;
  date: string;
  branch: string;
  summary: string;
  taskCodes: string[];
}

/** 从正文与模型原文中扫描任务编号（去重保序） */
export function extractTaskCodesFromReportText(originalText: string, rawModelResponse: string): string[] {
  const hay = `${originalText}\n${rawModelResponse}`;
  const seen = new Set<string>();
  const out: string[] = [];
  hay.replace(TASK_CODE_RE, (m) => {
    if (!seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
    return m;
  });
  return out;
}

/**
 * 将日报正文压成约 200 字以内：去空白、优先在句号处截断，否则硬截断加省略号。
 */
export function summarizeReportBodyHeuristic200(originalText: string): string {
  const t = originalText.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n+/g, " ").trim();
  if (!t) return "（无正文）";
  const max = 200;
  const chars = [...t];
  if (chars.length <= max) return t;
  const joined = chars.slice(0, max).join("");
  const lastBreak = Math.max(
    joined.lastIndexOf("。"),
    joined.lastIndexOf("！"),
    joined.lastIndexOf("？"),
    joined.lastIndexOf("；"),
  );
  if (lastBreak >= 80) return joined.slice(0, lastBreak + 1);
  return `${joined.slice(0, max - 1)}…`;
}

function entryFromItem(item: ExtractionHistoryItem): ReportDynamicMemoryEntry {
  return {
    extractionHistoryId: item.id,
    date: pickExtractionDate(item),
    branch: pickBranchCompany(item),
    summary: summarizeReportBodyHeuristic200(item.originalText ?? ""),
    taskCodes: extractTaskCodesFromReportText(item.originalText ?? "", item.rawModelResponse ?? ""),
  };
}

function formatEntriesAsText(entries: ReportDynamicMemoryEntry[]): string {
  if (entries.length === 0) return "（当前无日报提取记忆）\n";
  const lines: string[] = [];
  for (const e of entries) {
    const codes = e.taskCodes.length ? e.taskCodes.join("、") : "—";
    lines.push(
      `— 日期：${e.date}｜分公司：${e.branch}｜历史ID：${e.extractionHistoryId}\n  摘要（≤200字）：${e.summary}\n  关联任务编号：${codes}`,
    );
  }
  return `${lines.join("\n")}\n共 ${entries.length} 条日报记忆。\n`;
}

/**
 * 与当前 `loadExtractionHistory` 结果一致时调用：全量重建并写入 localStorage。
 */
export function rebuildReportDynamicMemoryFromHistory(items: ExtractionHistoryItem[]): void {
  try {
    const entries = items.map(entryFromItem);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    localStorage.setItem(`${STORAGE_KEY}_text`, formatEntriesAsText(entries));
  } catch {
    /* ignore quota */
  }
}

export function loadReportDynamicMemoryText(): string {
  try {
    const text = localStorage.getItem(`${STORAGE_KEY}_text`);
    if (text?.trim()) return text.trim();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ReportDynamicMemoryEntry[];
      if (Array.isArray(parsed)) return formatEntriesAsText(parsed).trim();
    }
  } catch {
    /* ignore */
  }
  return "（尚未生成日报动态记忆。）";
}
