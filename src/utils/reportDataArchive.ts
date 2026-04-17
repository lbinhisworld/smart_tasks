/**
 * @fileoverview 静态归档 `public/report_data.md`：解析 fenced JSON 或整段 JSON，并与单条提取历史合并为可下载/预览对象。
 *
 * **设计要点**
 * - `buildArchiveRootFromHistoryItem` 将 `原始内容` 置于展开对象前，元数据字段置后，保证同名字段以历史为准（若 JSON 内已有 `id` 等会被覆盖）。
 * - `loadReportArchiveEntries` 统一为对象数组，供抽屉列表与按 `id` 查找。
 *
 * @module reportDataArchive
 */

import type { ExtractionHistoryItem } from "../types/extractionHistory";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 从 Markdown 中提取首个 \`\`\`json … \`\`\` 代码块并 `JSON.parse`；若无代码块且正文以 `[` `{` 开头则整段解析。
 * @throws JSON 语法错误时由调用方捕获
 */
export function parseReportDataMarkdown(md: string): unknown {
  const fence = md.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const raw = fence[1].trim();
    if (raw) return JSON.parse(raw) as unknown;
  }
  const t = md.trim();
  if (t.startsWith("[") || t.startsWith("{")) return JSON.parse(t) as unknown;
  return [];
}

/**
 * 将单条提取历史合并为「归档根」平面对象：含 `原始内容` 与解析字段，并以 `id`/`savedAt`/标题等元数据**末尾覆盖**同名字段。
 */
export function buildArchiveRootFromHistoryItem(item: ExtractionHistoryItem): Record<string, unknown> {
  const base = isRecord(item.parsedJson) ? { ...item.parsedJson } : {};
  return {
    原始内容: item.originalText,
    ...base,
    id: item.id,
    savedAt: item.savedAt,
    displayTitle: item.displayTitle,
    fileName: item.fileName,
  };
}

/** 请求站点根路径下的 `report_data.md`（`no-store` 避免开发时缓存陈旧）。 */
export async function fetchReportDataMarkdown(): Promise<string> {
  const res = await fetch("/report_data.md", { cache: "no-store" });
  if (!res.ok) throw new Error(`无法加载 report_data.md（HTTP ${res.status}）`);
  return res.text();
}

/**
 * 拉取并解析归档文件，得到对象数组；根为单对象时包成一元数组；非对象元素过滤掉。
 */
export async function loadReportArchiveEntries(): Promise<Record<string, unknown>[]> {
  const md = await fetchReportDataMarkdown();
  const data = parseReportDataMarkdown(md);
  if (Array.isArray(data)) {
    return data.filter(isRecord) as Record<string, unknown>[];
  }
  if (isRecord(data)) return [data];
  return [];
}

/** 在已加载的归档条目中线性查找 `id`（与历史记录 `id` 对齐）。 */
export function findArchiveEntryById(
  entries: Record<string, unknown>[],
  id: string,
): Record<string, unknown> | undefined {
  return entries.find((e) => e.id === id);
}
