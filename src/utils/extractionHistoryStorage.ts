import type { ExtractionHistoryItem, LlmCallStats } from "../types/extractionHistory";

const STORAGE_KEY = "qifeng_extraction_history_v1";
/** 本地保存条数上限（追加与导入均适用） */
export const MAX_HISTORY_ITEMS = 200;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
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

/** 校验并解析导入 JSON，返回可写入的记录列表（跳过无效项） */
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

    out.push({
      id,
      savedAt,
      fileName,
      originalText,
      rawModelResponse,
      parsedJson: parsedJson ?? null,
      displayTitle: typeof el.displayTitle === "string" ? el.displayTitle : undefined,
      llmStats: parseLlmStats(el.llmStats),
    });
  }
  return out;
}

export function loadExtractionHistory(): ExtractionHistoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as ExtractionHistoryItem[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function appendExtractionHistory(item: ExtractionHistoryItem): ExtractionHistoryItem[] {
  const prev = loadExtractionHistory();
  const next = [item, ...prev].slice(0, MAX_HISTORY_ITEMS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function removeExtractionHistoryItem(id: string): ExtractionHistoryItem[] {
  const next = loadExtractionHistory().filter((x) => x.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

/** 用导入数据完全覆盖本地提取历史（会截断至 MAX_HISTORY_ITEMS 条） */
export function replaceExtractionHistory(items: ExtractionHistoryItem[]): ExtractionHistoryItem[] {
  const next = items.slice(0, MAX_HISTORY_ITEMS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
