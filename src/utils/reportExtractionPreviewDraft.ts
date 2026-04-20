/**
 * @fileoverview 报告提取页「预览区」草稿：刷新或离开页面后再进入时恢复结构化解析结果；新一轮解析开始时清空。
 */

import type { LlmCallStats } from "../types/extractionHistory";
import type { HubDailyStandardRow } from "./extractDataHubDailyList";

const STORAGE_KEY = "qifeng_report_extraction_preview_draft_v1";

export type StoredHubBranchParse = {
  id: string;
  title: string;
  row: HubDailyStandardRow;
  rawModel: string | null;
  parsed: unknown | null;
  llmError?: string;
  status: "extracting" | "done" | "error";
  detailsOpen: boolean;
};

export type ReportExtractionPreviewDraftV1 =
  | {
      version: 1;
      mode: "single";
      extracted: { text: string; note?: string };
      rawModel: string;
      parsed: unknown | null;
      llmCallStats: LlmCallStats | null;
      parseError: string | null;
    }
  | {
      version: 1;
      mode: "hub";
      manualFromDataHub: true;
      hubStandardRows: HubDailyStandardRow[];
      hubBranchParses: StoredHubBranchParse[];
      llmCallStats: LlmCallStats | null;
    };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseHubRow(v: unknown): HubDailyStandardRow | null {
  if (!isRecord(v)) return null;
  const date = v.date;
  const company_name = v.company_name;
  const content = v.content;
  return {
    date: date == null ? null : String(date),
    company_name: company_name == null ? null : String(company_name),
    content: content == null ? null : String(content),
  };
}

function parseLlmStats(v: unknown): LlmCallStats | null {
  if (!isRecord(v)) return null;
  const model = v.model;
  if (typeof model !== "string" || !model.trim()) return null;
  const inputTokens = v.inputTokens;
  const outputTokens = v.outputTokens;
  const totalTokens = v.totalTokens;
  const durationMs = v.durationMs;
  return {
    model,
    inputTokens: typeof inputTokens === "number" && Number.isFinite(inputTokens) ? inputTokens : null,
    outputTokens: typeof outputTokens === "number" && Number.isFinite(outputTokens) ? outputTokens : null,
    totalTokens: typeof totalTokens === "number" && Number.isFinite(totalTokens) ? totalTokens : null,
    durationMs: typeof durationMs === "number" && Number.isFinite(durationMs) ? durationMs : 0,
  };
}

function parseStoredBranch(v: unknown): StoredHubBranchParse | null {
  if (!isRecord(v)) return null;
  const id = v.id;
  const title = v.title;
  const status = v.status;
  const detailsOpen = v.detailsOpen;
  const row = parseHubRow(v.row);
  if (typeof id !== "string" || typeof title !== "string" || !row) return null;
  if (status !== "extracting" && status !== "done" && status !== "error") return null;
  const rawModel = v.rawModel;
  const llmError = v.llmError;
  return {
    id,
    title,
    row,
    rawModel: rawModel == null ? null : String(rawModel),
    parsed: v.parsed === undefined ? null : v.parsed,
    llmError: typeof llmError === "string" ? llmError : undefined,
    status,
    detailsOpen: Boolean(detailsOpen),
  };
}

function tryParseDraft(raw: string): ReportExtractionPreviewDraftV1 | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || data.version !== 1 || (data.mode !== "single" && data.mode !== "hub")) {
    return null;
  }
  if (data.mode === "single") {
    const extracted = data.extracted;
    const rawModel = data.rawModel;
    if (!isRecord(extracted) || typeof extracted.text !== "string" || typeof rawModel !== "string") {
      return null;
    }
    const note = extracted.note;
    return {
      version: 1,
      mode: "single",
      extracted: {
        text: extracted.text,
        note: typeof note === "string" ? note : undefined,
      },
      rawModel,
      parsed: data.parsed === undefined ? null : data.parsed,
      llmCallStats: parseLlmStats(data.llmCallStats),
      parseError: typeof data.parseError === "string" ? data.parseError : null,
    };
  }
  const rowsRaw = data.hubStandardRows;
  const parsesRaw = data.hubBranchParses;
  if (!Array.isArray(rowsRaw) || !Array.isArray(parsesRaw)) return null;
  const hubStandardRows: HubDailyStandardRow[] = [];
  for (const r of rowsRaw) {
    const row = parseHubRow(r);
    if (row) hubStandardRows.push(row);
  }
  const hubBranchParses: StoredHubBranchParse[] = [];
  for (const p of parsesRaw) {
    const b = parseStoredBranch(p);
    if (b) hubBranchParses.push(b);
  }
  if (hubBranchParses.length === 0) return null;
  return {
    version: 1,
    mode: "hub",
    manualFromDataHub: true,
    hubStandardRows: hubStandardRows.length > 0 ? hubStandardRows : hubBranchParses.map((x) => x.row),
    hubBranchParses,
    llmCallStats: parseLlmStats(data.llmCallStats),
  };
}

export function loadReportExtractionPreviewDraft(): ReportExtractionPreviewDraftV1 | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return tryParseDraft(raw);
  } catch {
    return null;
  }
}

export function saveReportExtractionPreviewDraft(draft: ReportExtractionPreviewDraftV1): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    /* quota or private mode */
  }
}

export function clearReportExtractionPreviewDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
