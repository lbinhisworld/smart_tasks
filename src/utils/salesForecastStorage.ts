/**
 * @fileoverview 销售预测：预览与销售分析底表持久化到 localStorage，切换页面后可恢复。
 */

import type { OrderSegmentResult } from "./calculateOrderSegments";
import type { SalesAnalysisBaseRow } from "./salesAnalysisBaseFromPreview";
import type { MaterialTag, MaterialTagKind } from "./parseMaterialCode";

const STORAGE_KEY = "qifeng_sales_forecast_v1";

export type SalesForecastPreviewPersisted = {
  headers: string[];
  rows: string[][];
  fileName: string;
};

export type SalesForecastAnalysisPersisted = {
  rows: SalesAnalysisBaseRow[];
  missingHint: string | null;
};

type PersistedV1 = {
  v: 1;
  preview: SalesForecastPreviewPersisted;
  analysisBase: SalesForecastAnalysisPersisted | null;
  /** 与底表配套的「生成数量分类」结果；无底表或未生成时为 null */
  orderSegments: OrderSegmentResult | null;
};

const TAG_KINDS: MaterialTagKind[] = ["id", "model", "name", "spec", "grammage", "source"];

function isMaterialTag(v: unknown): v is MaterialTag {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.text === "string" &&
    typeof o.kind === "string" &&
    (TAG_KINDS as readonly string[]).includes(o.kind)
  );
}

function isSalesAnalysisRow(v: unknown): v is SalesAnalysisBaseRow {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const keys = ["date", "customerName", "salesGroup", "salesperson", "materialMergedCode", "quantity"] as const;
  for (const k of keys) {
    if (typeof o[k] !== "string") return false;
  }
  if (!Array.isArray(o.materialTags)) return false;
  return o.materialTags.every(isMaterialTag);
}

function isStringMatrix(v: unknown): v is string[][] {
  return Array.isArray(v) && v.every((row) => Array.isArray(row) && row.every((c) => typeof c === "string"));
}

function isOrderSegmentResult(v: unknown): v is OrderSegmentResult {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const th = o.thresholds;
  const sl = o.segment_logic;
  if (typeof th !== "object" || th === null) return false;
  const t = th as Record<string, unknown>;
  if (typeof t.fragmented_limit !== "number" || typeof t.high_limit !== "number") return false;
  if (!Number.isFinite(t.fragmented_limit) || !Number.isFinite(t.high_limit)) return false;
  if (typeof sl !== "object" || sl === null) return false;
  const s = sl as Record<string, unknown>;
  if (typeof s.fragmented_volume_contribution_pct !== "number") return false;
  if (typeof s.high_volume_contribution_pct !== "number") return false;
  return true;
}

function parsePersisted(raw: unknown): PersistedV1 | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  const preview = o.preview;
  if (typeof preview !== "object" || preview === null) return null;
  const p = preview as Record<string, unknown>;
  if (!Array.isArray(p.headers) || !p.headers.every((h) => typeof h === "string")) return null;
  if (typeof p.fileName !== "string") return null;
  if (!isStringMatrix(p.rows)) return null;

  let analysisBase: SalesForecastAnalysisPersisted | null = null;
  if (o.analysisBase != null) {
    const ab = o.analysisBase;
    if (typeof ab !== "object" || ab === null) return null;
    const a = ab as Record<string, unknown>;
    const hint = a.missingHint;
    if (hint !== null && typeof hint !== "string") return null;
    if (!Array.isArray(a.rows) || !a.rows.every(isSalesAnalysisRow)) return null;
    analysisBase = { rows: a.rows, missingHint: hint };
  }

  let orderSegments: OrderSegmentResult | null = null;
  if (analysisBase != null && o.orderSegments != null && isOrderSegmentResult(o.orderSegments)) {
    orderSegments = o.orderSegments;
  }

  return {
    v: 1,
    preview: {
      headers: p.headers as string[],
      rows: p.rows,
      fileName: p.fileName,
    },
    analysisBase,
    orderSegments,
  };
}

export function loadSalesForecastPersisted(): PersistedV1 | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw?.trim()) return null;
    const data: unknown = JSON.parse(raw);
    return parsePersisted(data);
  } catch {
    return null;
  }
}

/** @returns 是否写入成功（配额不足等为 false） */
export function saveSalesForecastPersisted(
  preview: SalesForecastPreviewPersisted,
  analysisBase: SalesForecastAnalysisPersisted | null,
  orderSegments: OrderSegmentResult | null = null,
): boolean {
  const payload: PersistedV1 = { v: 1, preview, analysisBase, orderSegments };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function clearSalesForecastPersisted(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
