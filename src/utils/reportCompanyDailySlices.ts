/**
 * @fileoverview 从当前报告提取结果收集「分公司 → 日报正文」列表，供任务进度更新按公司串行处理。
 */

import type { StoredHubBranchParse } from "./reportExtractionPreviewDraft";
import { formatExtractionDate } from "./llmExtract";

export function normalizeReportCompanyName(raw: string): string {
  return raw.trim().replace(/[/\\]/g, "·");
}

export interface ReportCompanyDailySlice {
  companyName: string;
  dailyPlainText: string;
  /** 当前日报「提取日期」或中台行日期，YYYY-MM-DD */
  reportDate: string;
}

function hubRowDate(row: { date: string | null }): string | null {
  const d = row.date?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/**
 * - 数据中台多卡：按预览卡顺序首次出现的分公司聚合正文（同一公司多条日报用分隔符合并）。
 * - 单卡解析：`分公司名称` + `extracted` 正文。
 */
export function collectReportCompanyDailySlices(
  hubBranchParses: StoredHubBranchParse[] | null,
  parsed: unknown | null,
  extractedText: string | null,
): ReportCompanyDailySlice[] {
  if (hubBranchParses?.length) {
    const order: string[] = [];
    const bodies = new Map<string, string[]>();
    const datesByCo = new Map<string, string[]>();
    for (const b of hubBranchParses) {
      const rawCo = b.row.company_name?.trim() ?? "";
      const cn = rawCo ? normalizeReportCompanyName(rawCo) : "";
      const content = b.row.content?.trim() ?? "";
      if (!cn || cn === "暂无") continue;
      if (!content) continue;
      if (!bodies.has(cn)) {
        bodies.set(cn, []);
        datesByCo.set(cn, []);
        order.push(cn);
      }
      bodies.get(cn)!.push(content);
      const dt = hubRowDate(b.row);
      if (dt) datesByCo.get(cn)!.push(dt);
    }
    return order.map((companyName) => ({
      companyName,
      dailyPlainText: bodies.get(companyName)!.join("\n\n—\n\n"),
      reportDate: datesByCo.get(companyName)?.[0] ?? formatExtractionDate(),
    }));
  }
  const t = extractedText?.trim();
  if (!t) return [];
  let companyName = "暂无";
  if (parsed && typeof parsed === "object" && parsed !== null) {
    const b = (parsed as Record<string, unknown>)["分公司名称"];
    if (typeof b === "string" && b.trim() && normalizeReportCompanyName(b) !== "暂无") {
      companyName = normalizeReportCompanyName(b);
    }
  }
  if (companyName === "暂无") return [];
  let reportDate = formatExtractionDate();
  if (parsed && typeof parsed === "object" && parsed !== null) {
    const d = (parsed as Record<string, unknown>)["提取日期"];
    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) reportDate = d;
  }
  return [{ companyName, dailyPlainText: t, reportDate }];
}
