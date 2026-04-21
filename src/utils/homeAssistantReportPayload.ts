/**
 * @fileoverview 报告主题：将提取历史项组装为供大模型使用的结构化 JSON 数组。
 */

import type { ExtractionHistoryItem } from "../types/extractionHistory";
import { pickBranchCompany, pickExtractionDate } from "./extractionHistoryGroup";

function parsedTopLevel(h: ExtractionHistoryItem): Record<string, unknown> | null {
  if (h.parsedJson != null && typeof h.parsedJson === "object" && !Array.isArray(h.parsedJson)) {
    return h.parsedJson as Record<string, unknown>;
  }
  try {
    const o = JSON.parse(h.rawModelResponse) as unknown;
    if (o && typeof o === "object" && !Array.isArray(o)) return o as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return null;
}

/** 每条合并 extraction 元数据与模型解析顶层对象（含 production_report） */
export function buildReportStructuredArrayForLlm(items: ExtractionHistoryItem[]): unknown[] {
  return items.map((h) => {
    const top = parsedTopLevel(h);
    if (top) {
      return {
        extraction_id: h.id,
        fileName: h.fileName,
        savedAt: h.savedAt,
        ...top,
      };
    }
    return {
      extraction_id: h.id,
      fileName: h.fileName,
      savedAt: h.savedAt,
      分公司名称: pickBranchCompany(h),
      提取日期: pickExtractionDate(h),
      production_report: null,
      _note: "本条暂无可用 parsedJson，仅能提供元数据字段",
    };
  });
}
