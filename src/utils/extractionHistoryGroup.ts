/**
 * @fileoverview 提取历史在「时间线 / 看板」维度的公共字段抽取：提取日期、分公司名、按日分组。
 *
 * **设计要点**
 * - `pickExtractionDate` / `pickBranchCompany` 均优先读 `parsedJson`，失败再 `JSON.parse(rawModelResponse)`，与存储时是否预解析无关。
 * - 分公司名中的 `/`、`\` 统一替换为 `·`，与 UI 与 `reportCitation` 中的锚定逻辑一致。
 * - `buildTimelineGroups` 按提取日期聚合，日内按 `savedAt` 降序，供报告管理时间线展示。
 *
 * @module extractionHistoryGroup
 */

import type { ExtractionHistoryItem } from "../types/extractionHistory";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 从记录中读取「提取日期」`YYYY-MM-DD`。
 * 顶层 JSON 字段「提取日期」须通过正则校验；否则退回 `savedAt` 的日期部分（前 10 位）。
 */
export function pickExtractionDate(item: ExtractionHistoryItem): string {
  const from = (o: Record<string, unknown>) => {
    const d = o["提取日期"];
    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) return d.trim();
    return null;
  };
  if (item.parsedJson != null && isRecord(item.parsedJson)) {
    const x = from(item.parsedJson);
    if (x) return x;
  }
  try {
    const o = JSON.parse(item.rawModelResponse) as unknown;
    if (isRecord(o)) {
      const x = from(o);
      if (x) return x;
    }
  } catch {
    /* ignore */
  }
  return item.savedAt.slice(0, 10);
}

/** 日报「提取日期」在界面上的展示（如 2026年4月17日） */
export function formatReportCalendarDateZh(iso: string): string {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso.trim() || "—";
  const [, y, mo, da] = m;
  return `${y}年${parseInt(mo, 10)}月${parseInt(da, 10)}日`;
}

/**
 * 从记录中读取「分公司名称」；缺失或非字符串时为「暂无」，并做路径分隔符规范化。
 */
export function pickBranchCompany(item: ExtractionHistoryItem): string {
  const from = (o: Record<string, unknown>) => {
    const b = o["分公司名称"];
    if (typeof b === "string" && b.trim()) return b.trim().replace(/[/\\]/g, "·");
    return "暂无";
  };
  if (item.parsedJson != null && isRecord(item.parsedJson)) {
    return from(item.parsedJson);
  }
  try {
    const o = JSON.parse(item.rawModelResponse) as unknown;
    if (isRecord(o)) return from(o);
  } catch {
    /* ignore */
  }
  return "暂无";
}

/**
 * 用于视角过滤、范围匹配：优先 JSON「分公司名称」；若为「暂无」则尝试从列表标题
 * `displayTitle`（格式 `YYYY-MM-DD-分公司名`）解析，避免分公司领导视角下整条历史被误隐藏。
 */
export function resolveBranchLabelForHistoryItem(item: ExtractionHistoryItem): string {
  const p = pickBranchCompany(item);
  if (p !== "暂无") return p;
  const t = item.displayTitle?.trim();
  if (!t) return "暂无";
  const m = t.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
  if (m?.[1]?.trim()) return m[1].trim().replace(/[/\\]/g, "·");
  return "暂无";
}

export interface TimelineDateGroup {
  date: string;
  /** 该日期下全部记录（按保存时间降序） */
  items: ExtractionHistoryItem[];
  totalItems: number;
  /** 该日期下去重后的分公司数量（仅用于摘要，不单独展示标签） */
  branchCount: number;
}

/**
 * 按提取日期降序；同一日期内记录按 `savedAt` 降序。
 * `branchCount` 为当日去重分公司数，仅用于摘要展示。
 */
export function buildTimelineGroups(items: ExtractionHistoryItem[]): TimelineDateGroup[] {
  const byDate = new Map<string, ExtractionHistoryItem[]>();
  for (const item of items) {
    const d = pickExtractionDate(item);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(item);
  }

  const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));

  return dates.map((date) => {
    const list = byDate.get(date)!;
    list.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    const branchSet = new Set(list.map((it) => pickBranchCompany(it)));
    return {
      date,
      items: list,
      totalItems: list.length,
      branchCount: branchSet.size,
    };
  });
}
