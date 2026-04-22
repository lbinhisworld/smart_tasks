/**
 * @fileoverview 日报详情中「已添加至议题」片段的持久化高亮：按日报行指纹存区间，供抽屉内批注式展示。
 *
 * @module dailyReportTopicHighlightStorage
 */

import type { DailyReportListDisplayRow } from "./reportDailyListFromDataHub";

const STORAGE_KEY = "qifeng_daily_report_topic_highlights_v1";

/** 从日报详情「添加至议题」传入父级的草稿（含用于回写高亮的区间） */
export interface DailyTopicDraftPayload {
  /** 议题描述预填（通常已 trim） */
  excerpt: string;
  /** `makeDailyRowKey` */
  rowKey: string;
  /** 在原文中的起止下标（与保存时高亮一致） */
  start: number;
  end: number;
  /** 打开详情时的正文长度，用于裁剪高亮 */
  fullTextLen: number;
}

/** 单行日报上的一段高亮区间（闭开区间在纯文本中的下标） */
export interface DailyReportHighlightSpan {
  /** 在 `reportDetail` 全文中的起始下标（含） */
  start: number;
  /** 在 `reportDetail` 全文中的结束下标（不含） */
  end: number;
  /** 保存议题后写入的议题编号，便于追溯 */
  topicCode?: string;
}

interface StoredRoot {
  /** `makeDailyRowKey` → 区间列表 */
  byRowKey: Record<string, DailyReportHighlightSpan[]>;
}

/**
 * FNV-1a 风格 32 位哈希，用于生成较短且稳定的行键。
 * @param s 输入串
 */
function hashString(s: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * 由展示行字段生成稳定键，用于与高亮数据关联（同内容同元数据则键相同）。
 * @param r 日报列表展示行
 */
export function makeDailyRowKey(r: DailyReportListDisplayRow): string {
  const basis = `${r.sortMs}\n${r.parentCompany}\n${r.deptWorkshop}\n${r.submitter}\n${r.reportDate}\n${r.submitTime}\n${r.reportDetail}`;
  return `dr_${hashString(basis)}`;
}

function loadRoot(): StoredRoot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)?.trim();
    if (!raw) return { byRowKey: {} };
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== "object" || !("byRowKey" in p)) return { byRowKey: {} };
    const byRowKey = (p as { byRowKey: unknown }).byRowKey;
    if (!byRowKey || typeof byRowKey !== "object") return { byRowKey: {} };
    return { byRowKey: byRowKey as Record<string, DailyReportHighlightSpan[]> };
  } catch {
    return { byRowKey: {} };
  }
}

function saveRoot(root: StoredRoot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(root));
  } catch {
    /* quota / private mode */
  }
}

/**
 * 合并重叠或相邻的区间（用于展示与去重）。
 * @param spans 原始区间
 */
export function mergeHighlightSpans(spans: DailyReportHighlightSpan[]): DailyReportHighlightSpan[] {
  const valid = spans.filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.start < s.end);
  if (valid.length === 0) return [];
  const sorted = [...valid].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: DailyReportHighlightSpan[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (!last || s.start > last.end) {
      out.push({ start: s.start, end: s.end, topicCode: s.topicCode });
    } else {
      last.end = Math.max(last.end, s.end);
      if (!last.topicCode && s.topicCode) last.topicCode = s.topicCode;
    }
  }
  return out;
}

/**
 * 读取某日报行已保存的高亮区间（已合并）。
 * @param rowKey `makeDailyRowKey` 返回值
 */
export function loadHighlightsForRow(rowKey: string): DailyReportHighlightSpan[] {
  const root = loadRoot();
  const list = root.byRowKey[rowKey];
  if (!Array.isArray(list) || list.length === 0) return [];
  return mergeHighlightSpans(
    list.filter(
      (s) =>
        s &&
        typeof s.start === "number" &&
        typeof s.end === "number" &&
        s.start < s.end,
    ),
  );
}

/**
 * 追加一段高亮并持久化；若与已有区间重叠则合并展示层由 `mergeHighlightSpans` 处理。
 * @param rowKey 日报行键
 * @param span 区间（若超出正文长度会被裁剪）
 * @param fullTextLen 正文长度，用于裁剪
 */
export function appendHighlightForRow(
  rowKey: string,
  span: DailyReportHighlightSpan,
  fullTextLen: number,
): void {
  if (!rowKey || fullTextLen <= 0) return;
  let start = Math.max(0, Math.floor(span.start));
  let end = Math.min(fullTextLen, Math.floor(span.end));
  if (start >= end) return;
  const root = loadRoot();
  const prev = root.byRowKey[rowKey] ?? [];
  const nextSpan: DailyReportHighlightSpan = {
    start,
    end,
    ...(span.topicCode?.trim() ? { topicCode: span.topicCode.trim() } : {}),
  };
  root.byRowKey[rowKey] = [...prev, nextSpan];
  saveRoot(root);
}
