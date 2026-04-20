/**
 * @fileoverview 报告提取预览：按 `production_report` 一级主题拆成多条「任务」切片，标题为 `提取日期-分公司/范围`。
 */

import { buildExtractionHistoryTitle } from "./extractionHistoryTitle";
import { formatExtractionDate } from "./llmExtract";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export interface ReportPreviewTaskSlice {
  id: string;
  /** 卡片标题：YYYY-MM-DD-分公司或该主题「范围」 */
  title: string;
  /** 含完整顶层 meta + 单主题 `production_report` 的 JSON 对象 */
  slice: unknown;
}

function topDateBranch(parsed: Record<string, unknown>): { date: string; branch: string } {
  const dRaw = parsed["提取日期"];
  const bRaw = parsed["分公司名称"];
  const date =
    typeof dRaw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dRaw.trim())
      ? dRaw.trim()
      : formatExtractionDate();
  const branch =
    typeof bRaw === "string" && bRaw.trim() ? bRaw.trim().replace(/[/\\]/g, "·") : "暂无";
  return { date, branch };
}

/**
 * 手动/附件单次解析：预览区只展示 **一张** 卡片（完整 `parsed`）。
 */
export function buildReportPreviewTasksSingle(parsed: unknown): ReportPreviewTaskSlice[] {
  if (parsed == null) return [];

  let title: string;
  if (typeof parsed === "object" && parsed !== null) {
    title =
      buildExtractionHistoryTitle(parsed, JSON.stringify(parsed)) ??
      `${formatExtractionDate()}-暂无`;
  } else {
    title = `${formatExtractionDate()}-暂无`;
  }

  return [{ id: "preview-single", title, slice: parsed }];
}

/**
 * 将一次解析得到的对象拆成多条预览任务；无法拆分时返回单条。
 * @deprecated 手动流程请使用 {@link buildReportPreviewTasksSingle}；保留供其它场景复用。
 */
export function buildReportPreviewTasks(parsed: unknown): ReportPreviewTaskSlice[] {
  if (!isRecord(parsed)) {
    return [
      {
        id: "single",
        title: `${formatExtractionDate()}-暂无`,
        slice: parsed,
      },
    ];
  }

  const { date, branch } = topDateBranch(parsed);
  const pr = parsed["production_report"];

  if (!isRecord(pr) || Object.keys(pr).length === 0) {
    return [{ id: "root", title: `${date}-${branch}`, slice: parsed }];
  }

  const entries = Object.entries(pr);
  return entries.map(([themeKey, themeNode], index) => {
    let label = branch;
    if (isRecord(themeNode) && typeof themeNode["范围"] === "string") {
      const sc = themeNode["范围"].trim();
      if (sc && sc !== "暂无") label = sc.replace(/[/\\]/g, "·");
    }
    const title = `${date}-${label}`;
    const slice: Record<string, unknown> = {
      ...parsed,
      production_report: { [themeKey]: themeNode },
    };
    const safeKey = themeKey.replace(/[^\w\u4e00-\u9fff-]/g, "_").slice(0, 32);
    return { id: `preview-task-${index}-${safeKey}`, title, slice };
  });
}
