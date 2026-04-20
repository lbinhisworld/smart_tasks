/**
 * @fileoverview 按分公司收集日报 JSON 中的「需公司协调」「下步计划」摘录及日期，供「日报计划任务生成」串行处理。
 */

import { extractCoordinationAndNextPlanPlainText } from "./buildPendingTasksFromSavedReport";
import { formatExtractionDate } from "./llmExtract";
import { normalizeReportCompanyName } from "./reportCompanyDailySlices";
import type { StoredHubBranchParse } from "./reportExtractionPreviewDraft";

export interface ReportCompanyPlanContext {
  companyName: string;
  dailyPlainText: string;
  coordinationPlain: string;
  nextPlanPlain: string;
  reportDate: string;
}

function hubRowDate(row: { date: string | null }): string | null {
  const d = row.date?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/**
 * 与中台多卡 / 单卡解析结果对齐：每个分公司合并多条日报的正文与 6.1/6.2 摘录。
 */
export function collectReportCompanyPlanContexts(
  hubBranchParses: StoredHubBranchParse[] | null,
  parsed: unknown | null,
  extractedText: string | null,
): ReportCompanyPlanContext[] {
  if (hubBranchParses?.length) {
    const order: string[] = [];
    const groups = new Map<
      string,
      { dailies: string[]; coordParts: string[]; planParts: string[]; dates: string[] }
    >();
    for (const b of hubBranchParses) {
      const rawCo = b.row.company_name?.trim() ?? "";
      const cn = rawCo ? normalizeReportCompanyName(rawCo) : "";
      if (!cn || cn === "暂无") continue;
      const content = b.row.content?.trim() ?? "";
      if (!groups.has(cn)) {
        groups.set(cn, { dailies: [], coordParts: [], planParts: [], dates: [] });
        order.push(cn);
      }
      const g = groups.get(cn)!;
      if (content) g.dailies.push(content);
      const dt = hubRowDate(b.row);
      if (dt) g.dates.push(dt);
      if (b.parsed != null) {
        const ex = extractCoordinationAndNextPlanPlainText(b.parsed);
        if (ex.coordinationPlain.trim()) g.coordParts.push(ex.coordinationPlain.trim());
        if (ex.nextPlanPlain.trim()) g.planParts.push(ex.nextPlanPlain.trim());
      }
    }
    return order.map((companyName) => {
      const g = groups.get(companyName)!;
      const dailyPlainText = g.dailies.join("\n\n—\n\n");
      const coordinationPlain = [...new Set(g.coordParts)].join("\n\n");
      const nextPlanPlain = [...new Set(g.planParts)].join("\n\n");
      const reportDate = g.dates[0] ?? formatExtractionDate();
      return {
        companyName,
        dailyPlainText,
        coordinationPlain,
        nextPlanPlain,
        reportDate,
      };
    });
  }

  const t = extractedText?.trim();
  if (!t || !parsed) return [];
  let companyName = "暂无";
  if (typeof parsed === "object" && parsed !== null) {
    const b = (parsed as Record<string, unknown>)["分公司名称"];
    if (typeof b === "string" && b.trim() && normalizeReportCompanyName(b) !== "暂无") {
      companyName = normalizeReportCompanyName(b);
    }
  }
  if (companyName === "暂无") return [];
  const ex = extractCoordinationAndNextPlanPlainText(parsed);
  let reportDate = formatExtractionDate();
  if (typeof parsed === "object" && parsed !== null) {
    const d = (parsed as Record<string, unknown>)["提取日期"];
    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) reportDate = d;
  }
  return [
    {
      companyName,
      dailyPlainText: t,
      coordinationPlain: ex.coordinationPlain,
      nextPlanPlain: ex.nextPlanPlain,
      reportDate,
    },
  ];
}
