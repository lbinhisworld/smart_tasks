/**
 * @fileoverview 提取历史「导出原始报告」：按日期、分公司、正文生成 JSON 并触发浏览器下载。
 */

import type { ExtractionHistoryItem } from "../types/extractionHistory";
import { pickBranchCompany, pickExtractionDate } from "./extractionHistoryGroup";

export function downloadOriginalReportsJsonFile(items: ExtractionHistoryItem[]) {
  const records = items.map((item) => ({
    日期: pickExtractionDate(item),
    公司: pickBranchCompany(item),
    原始报告内容: item.originalText,
  }));
  const json = `${JSON.stringify(records, null, 2)}\n`;
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  a.href = url;
  a.download = `原始报告导出-${stamp}.json`;
  a.rel = "noopener";
  a.click();
  URL.revokeObjectURL(url);
}
