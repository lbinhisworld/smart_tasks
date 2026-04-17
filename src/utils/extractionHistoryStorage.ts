/**
 * @fileoverview 提取历史的本地持久化：`localStorage` 单键 JSON 数组，支持追加、删除、整表导入覆盖。
 *
 * **设计要点**
 * - 与任务模块使用不同 `STORAGE_KEY`，避免数据结构冲突。
 * - `MAX_HISTORY_ITEMS` 限制数组长度，防止 localStorage 膨胀；追加与 `replaceExtractionHistory` 均截断。
 * - `parseImportedExtractionHistory` 宽松接受「裸数组」或 `{ items: [] }」，逐项校验类型，静默跳过坏项而非整批失败。
 *
 * @module extractionHistoryStorage
 */

import type {
  ExtractionHistoryItem,
  LlmCallStats,
  PendingAiSuggestionTaskRow,
  PendingDailyPlanTaskRow,
  QuantitativeMetricCitation,
} from "../types/extractionHistory";
import {
  buildPendingTasksFromSavedReport,
  PENDING_AI_SUGGESTION_TEMPLATE,
} from "./buildPendingTasksFromSavedReport";
import { pickExtractionDate } from "./extractionHistoryGroup";

const STORAGE_KEY = "qifeng_extraction_history_v1";
/** 本地保存条数上限（追加与导入均适用） */
export const MAX_HISTORY_ITEMS = 200;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseQuantitativeMetricCitationsRow(v: unknown): QuantitativeMetricCitation[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: QuantitativeMetricCitation[] = [];
  for (const el of v) {
    if (!isRecord(el)) continue;
    const path = el.path;
    const metricLabel = el.metricLabel;
    const valueText = el.valueText;
    const excerpt = el.excerpt;
    if (
      typeof path !== "string" ||
      typeof metricLabel !== "string" ||
      typeof valueText !== "string" ||
      typeof excerpt !== "string"
    ) {
      continue;
    }
    const mi = el.matchIndex;
    const sk = el.sourceKind;
    const sourceKind =
      sk === "literal" || sk === "auto_computed" ? sk : undefined;
    let excerptHighlights: { start: number; end: number }[] | undefined;
    const eh = el.excerptHighlights;
    if (Array.isArray(eh)) {
      const pairs: { start: number; end: number }[] = [];
      for (const h of eh) {
        if (!isRecord(h)) continue;
        const s = h.start;
        const e = h.end;
        if (typeof s === "number" && typeof e === "number" && Number.isFinite(s) && Number.isFinite(e) && e > s) {
          pairs.push({ start: s, end: e });
        }
      }
      if (pairs.length) excerptHighlights = pairs;
    }
    out.push({
      path,
      metricLabel,
      valueText,
      excerpt,
      sourceKind,
      matchIndex: typeof mi === "number" && Number.isFinite(mi) ? mi : -1,
      excerptStart: typeof el.excerptStart === "number" ? el.excerptStart : undefined,
      excerptEnd: typeof el.excerptEnd === "number" ? el.excerptEnd : undefined,
      excerptHighlights,
    });
  }
  return out.length ? out : undefined;
}

function isValidIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

function parsePendingDailyPlanTasks(
  v: unknown,
  fallbackReportDate: string,
): PendingDailyPlanTaskRow[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: PendingDailyPlanTaskRow[] = [];
  for (const el of v) {
    if (!isRecord(el)) continue;
    const { id, initiatingDepartment, requestDescription, extractionHistoryId, jumpNeedle } = el;
    if (
      typeof id === "string" &&
      typeof initiatingDepartment === "string" &&
      typeof requestDescription === "string" &&
      typeof extractionHistoryId === "string" &&
      typeof jumpNeedle === "string"
    ) {
      const rd = el.reportDate;
      const reportDate = isValidIsoDate(rd) ? rd.trim() : fallbackReportDate;
      const ed = el.executingDepartment;
      const executingDepartment =
        typeof ed === "string" && ed.trim() ? ed.trim() : "待明确";
      out.push({
        id,
        initiatingDepartment,
        executingDepartment,
        reportDate,
        requestDescription,
        extractionHistoryId,
        jumpNeedle,
      });
    }
  }
  return out.length ? out : undefined;
}

function parsePendingAiSuggestionTasks(
  v: unknown,
  fallbackReportDate: string,
): PendingAiSuggestionTaskRow[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: PendingAiSuggestionTaskRow[] = [];
  for (const el of v) {
    if (!isRecord(el)) continue;
    const { id, relatedDepartments, discoveredIssue, extractionHistoryId, jumpNeedle } = el;
    if (
      typeof id === "string" &&
      typeof relatedDepartments === "string" &&
      typeof discoveredIssue === "string" &&
      typeof extractionHistoryId === "string" &&
      typeof jumpNeedle === "string"
    ) {
      const rd = el.reportDate;
      const reportDate = isValidIsoDate(rd) ? rd.trim() : fallbackReportDate;
      const asg = el.aiSuggestion;
      let discoveredOnly = discoveredIssue;
      let aiSuggestion = PENDING_AI_SUGGESTION_TEMPLATE;
      if (typeof asg === "string" && asg.trim()) {
        aiSuggestion = asg.trim();
      } else {
        const legacyInner = discoveredIssue.match(/指出：「([^」]+)」/);
        if (legacyInner?.[1]) {
          const body = legacyInner[1].trim();
          discoveredOnly = body.endsWith("。") ? body : `${body}。`;
        }
      }
      out.push({
        id,
        relatedDepartments,
        reportDate,
        discoveredIssue: discoveredOnly,
        aiSuggestion,
        extractionHistoryId,
        jumpNeedle,
      });
    }
  }
  return out.length ? out : undefined;
}

function pendingRowsMissingReportDate(item: ExtractionHistoryItem): boolean {
  const rows = [...(item.pendingDailyPlanTasks ?? []), ...(item.pendingAiSuggestionTasks ?? [])];
  return rows.some((r) => !isValidIsoDate(r.reportDate));
}

function pendingDailyPlanMissingExecutingDept(item: ExtractionHistoryItem): boolean {
  const rows = item.pendingDailyPlanTasks ?? [];
  return rows.some((r) => typeof r.executingDepartment !== "string" || !r.executingDepartment.trim());
}

function pendingAiMissingAiSuggestionField(item: ExtractionHistoryItem): boolean {
  const rows = item.pendingAiSuggestionTasks ?? [];
  return rows.some((r) => typeof r.aiSuggestion !== "string" || !r.aiSuggestion.trim());
}

function normalizePendingRowReportDates(item: ExtractionHistoryItem): ExtractionHistoryItem {
  const d = pickExtractionDate(item);
  const fixPlan = (rows: PendingDailyPlanTaskRow[] | undefined): PendingDailyPlanTaskRow[] | undefined => {
    if (!rows?.length) return rows;
    return rows.map((r) => ({
      ...r,
      reportDate: isValidIsoDate(r.reportDate) ? r.reportDate.trim() : d,
    }));
  };
  const fixAi = (rows: PendingAiSuggestionTaskRow[] | undefined): PendingAiSuggestionTaskRow[] | undefined => {
    if (!rows?.length) return rows;
    return rows.map((r) => ({
      ...r,
      reportDate: isValidIsoDate(r.reportDate) ? r.reportDate.trim() : d,
    }));
  };
  return {
    ...item,
    pendingDailyPlanTasks: fixPlan(item.pendingDailyPlanTasks),
    pendingAiSuggestionTasks: fixAi(item.pendingAiSuggestionTasks),
  };
}

function parseLlmStats(v: unknown): LlmCallStats | undefined {
  if (!isRecord(v)) return undefined;
  const model = v.model;
  if (typeof model !== "string" || !model.trim()) return undefined;
  const num = (x: unknown) =>
    typeof x === "number" && Number.isFinite(x) ? x : null;
  return {
    model: model.trim(),
    inputTokens: num(v.inputTokens),
    outputTokens: num(v.outputTokens),
    totalTokens: num(v.totalTokens),
    durationMs: typeof v.durationMs === "number" && Number.isFinite(v.durationMs) ? v.durationMs : 0,
  };
}

/**
 * 校验并解析导入 JSON，返回可写入的记录列表（跳过无效项）。
 *
 * @throws 当根结构既不是数组也不是 `{ items: array }` 时抛出明确中文错误
 * @returns 仅包含通过字段校验的项；`parsedJson` 允许为 `null` 或省略
 */
export function parseImportedExtractionHistory(json: unknown): ExtractionHistoryItem[] {
  let arr: unknown[];
  if (Array.isArray(json)) {
    arr = json;
  } else if (isRecord(json) && Array.isArray(json.items)) {
    arr = json.items;
  } else {
    throw new Error("文件格式应为 JSON 数组，或包含 items 数组的对象。");
  }

  const out: ExtractionHistoryItem[] = [];
  for (const el of arr) {
    if (!isRecord(el)) continue;
    const id = el.id;
    const savedAt = el.savedAt;
    const fileName = el.fileName;
    const originalText = el.originalText;
    const rawModelResponse = el.rawModelResponse;
    if (
      typeof id !== "string" ||
      typeof savedAt !== "string" ||
      typeof fileName !== "string" ||
      typeof originalText !== "string" ||
      typeof rawModelResponse !== "string"
    ) {
      continue;
    }
    const parsedJson =
      "parsedJson" in el && (el.parsedJson === null || el.parsedJson === undefined)
        ? null
        : el.parsedJson;

    const draft: ExtractionHistoryItem = {
      id,
      savedAt,
      fileName,
      originalText,
      rawModelResponse,
      parsedJson: parsedJson ?? null,
      displayTitle: typeof el.displayTitle === "string" ? el.displayTitle : undefined,
      llmStats: parseLlmStats(el.llmStats),
      quantitativeMetricCitations: parseQuantitativeMetricCitationsRow(el.quantitativeMetricCitations),
    };
    const fallbackDate = pickExtractionDate(draft);
    out.push({
      ...draft,
      pendingDailyPlanTasks: parsePendingDailyPlanTasks(el.pendingDailyPlanTasks, fallbackDate),
      pendingAiSuggestionTasks: parsePendingAiSuggestionTasks(el.pendingAiSuggestionTasks, fallbackDate),
    });
  }
  return out;
}

/** 读取本地存储；解析失败或非数组时返回空数组，不抛异常。 */
export function loadExtractionHistory(): ExtractionHistoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as ExtractionHistoryItem[];
    if (!Array.isArray(arr)) return [];
    let changed = false;
    const mapped = arr.map((item) => {
      let working = item as ExtractionHistoryItem;
      if (pendingRowsMissingReportDate(working)) {
        changed = true;
        working = normalizePendingRowReportDates(working);
      }

      const missingPending =
        working.pendingDailyPlanTasks === undefined && working.pendingAiSuggestionTasks === undefined;
      const staleDailyExecuting =
        !missingPending &&
        pendingDailyPlanMissingExecutingDept(working) &&
        working.parsedJson != null &&
        typeof working.parsedJson === "object";
      const staleAiSuggestionColumn =
        !missingPending &&
        pendingAiMissingAiSuggestionField(working) &&
        working.parsedJson != null &&
        typeof working.parsedJson === "object";
      if (!missingPending && !staleDailyExecuting && !staleAiSuggestionColumn) {
        return working;
      }
      if (working.parsedJson == null || typeof working.parsedJson !== "object") {
        return working;
      }
      const built = buildPendingTasksFromSavedReport(working);
      if (built.pendingDailyPlanTasks.length === 0 && built.pendingAiSuggestionTasks.length === 0) {
        changed = true;
        return {
          ...working,
          pendingDailyPlanTasks: [],
          pendingAiSuggestionTasks: [],
        };
      }
      changed = true;
      return { ...working, ...built };
    });
    if (changed) {
      const next = mapped.slice(0, MAX_HISTORY_ITEMS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    }
    return mapped;
  } catch {
    return [];
  }
}

/**
 * 新记录插到表头，并截断至 `MAX_HISTORY_ITEMS`。
 * @returns 写入后的完整列表（便于调用方直接 `setState`）
 */
export function appendExtractionHistory(item: ExtractionHistoryItem): ExtractionHistoryItem[] {
  const prev = loadExtractionHistory();
  const next = [item, ...prev].slice(0, MAX_HISTORY_ITEMS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

/** @returns 删除后的完整列表 */
export function removeExtractionHistoryItem(id: string): ExtractionHistoryItem[] {
  const next = loadExtractionHistory().filter((x) => x.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

/**
 * 用导入数据完全覆盖本地提取历史。
 * @returns 截断至 `MAX_HISTORY_ITEMS` 后的列表
 */
export function replaceExtractionHistory(items: ExtractionHistoryItem[]): ExtractionHistoryItem[] {
  const next = items.slice(0, MAX_HISTORY_ITEMS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
