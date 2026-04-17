/**
 * @fileoverview 提取历史列表默认标题：`YYYY-MM-DD-分公司名`，与分组键 `pickExtractionDate` / `pickBranchCompany` 语义对齐。
 *
 * @module extractionHistoryTitle
 */

import { formatExtractionDate } from "./llmExtract";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 从解析结果得到 `YYYY-MM-DD-分公司名`。
 * 日期非法时回退为 `formatExtractionDate()`（当前本地日）；分公司名规则与 `pickBranchCompany` 一致。
 * @returns 无法得到对象结构时 `null`（调用方可改用文件名等兜底）
 */
export function buildExtractionHistoryTitle(
  parsedJson: unknown | null,
  rawModelResponse: string,
): string | null {
  let o: Record<string, unknown> | null = null;
  if (isRecord(parsedJson)) o = parsedJson;
  else {
    try {
      const p = JSON.parse(rawModelResponse.trim()) as unknown;
      if (isRecord(p)) o = p;
    } catch {
      return null;
    }
  }
  if (!o) return null;

  const dRaw = o["提取日期"];
  const bRaw = o["分公司名称"];
  const date =
    typeof dRaw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dRaw.trim())
      ? dRaw.trim()
      : formatExtractionDate();
  const branch =
    typeof bRaw === "string" && bRaw.trim() ? bRaw.trim().replace(/[/\\]/g, "·") : "暂无";

  return `${date}-${branch}`;
}
