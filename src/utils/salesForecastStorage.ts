/**
 * @fileoverview 销售预测：预览、销售分析底表、数量分类、客户进货周期性分析数据持久化到 localStorage；另存视图 Tab 偏好，刷新/换页后仍能回到调试模式查看。
 */

import type {
  CustomerInboundDimensionRow,
  CustomerInboundGrammageRow,
  CustomerInboundModelRow,
  CustomerInboundNameRow,
  CustomerInboundSkuRow,
  CustomerInboundSpecRow,
} from "./buildCustomerInboundDimensionFromAnalysis";
import { migrateLegacySkusToModels } from "./buildCustomerInboundDimensionFromAnalysis";
import type { OrderSegmentResult } from "./calculateOrderSegments";
import type { SalesAnalysisBaseRow } from "./salesAnalysisBaseFromPreview";
import type { MaterialTag, MaterialTagKind } from "./parseMaterialCode";

export type {
  CustomerInboundDimensionRow,
  CustomerInboundGrammageRow,
  CustomerInboundModelRow,
  CustomerInboundNameRow,
  CustomerInboundSkuRow,
  CustomerInboundSpecRow,
} from "./buildCustomerInboundDimensionFromAnalysis";

const STORAGE_KEY = "qifeng_sales_forecast_v1";
/** 与主 payload 分离，避免在已有 save 中漏传导致 Tab 被覆盖；用于「用户/调试显示模式」 */
const VIEW_TAB_STORAGE_KEY = "qifeng_sales_forecast_view_tab_v1";

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
  orderSegments: OrderSegmentResult | null;
  customerInboundDimension: CustomerInboundDimensionRow[] | null;
  /** 用户已跑过「计算下单次数」分步汇总并成功保存；用于刷新后恢复绿底白字按钮态 */
  orderCountComputeCompleted: boolean;
  /** 用户已跑过「计算订货间隔标准差」分步汇总并成功保存；用于刷新后恢复绿底白字按钮态 */
  orderIntervalStdDevComputeCompleted: boolean;
};

export type SaveSalesForecastPersistedOptions = {
  /** 为 true 表示本轮保存后应视为已跑完「计算下单次数」；为 false 表示重置。不传则与本地已有值一致。 */
  orderCountComputeCompleted?: boolean;
  /** 为 true 表示本轮保存后应视为已跑完「计算订货间隔标准差」；为 false 表示重置。不传则与本地已有值一致。 */
  orderIntervalStdDevComputeCompleted?: boolean;
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

function isDimMetrics(o: Record<string, unknown>): boolean {
  return (
    typeof o.lastOrderDate === "string" &&
    typeof o.orderIntervalStdDev === "string" &&
    typeof o.orderIntervalMean === "string" &&
    typeof o.periodicityLabel === "string" &&
    (o.orderCount === undefined || typeof o.orderCount === "string")
  );
}

function isCustomerInboundGrammageRow(v: unknown): v is CustomerInboundGrammageRow {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.grammage === "string" && isDimMetrics(o);
}

function isCustomerInboundSpecRow(v: unknown): v is CustomerInboundSpecRow {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.spec !== "string" || !isDimMetrics(o)) return false;
  if (!Array.isArray(o.grammages)) return false;
  return o.grammages.every(isCustomerInboundGrammageRow);
}

function isCustomerInboundNameRow(v: unknown): v is CustomerInboundNameRow {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.productName !== "string" || !isDimMetrics(o)) return false;
  if (!Array.isArray(o.specs)) return false;
  return o.specs.every(isCustomerInboundSpecRow);
}

function isCustomerInboundModelRow(v: unknown): v is CustomerInboundModelRow {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.model !== "string" || !isDimMetrics(o)) return false;
  if (!Array.isArray(o.names)) return false;
  return o.names.every(isCustomerInboundNameRow);
}

function isCustomerInboundSkuRow(v: unknown): v is CustomerInboundSkuRow {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.model === "string" &&
    typeof o.productName === "string" &&
    isDimMetrics(o)
  );
}

function normalizeCustomerInboundDimensionRow(v: unknown): CustomerInboundDimensionRow | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.customerName !== "string" || !isDimMetrics(o)) {
    return null;
  }

  let models: CustomerInboundModelRow[] = [];
  if (Array.isArray(o.models) && o.models.every(isCustomerInboundModelRow)) {
    models = o.models as CustomerInboundModelRow[];
  } else if (Array.isArray(o.skus) && o.skus.length > 0 && o.skus.every(isCustomerInboundSkuRow)) {
    models = migrateLegacySkusToModels(o.skus as CustomerInboundSkuRow[]);
  }

  return {
    customerName: o.customerName,
    lastOrderDate: o.lastOrderDate as string,
    orderCount: typeof o.orderCount === "string" ? o.orderCount : "—",
    orderIntervalStdDev: o.orderIntervalStdDev as string,
    orderIntervalMean: o.orderIntervalMean as string,
    periodicityLabel: o.periodicityLabel as string,
    models,
  };
}

function withDefaultOrderCountDeep(
  row: CustomerInboundDimensionRow,
): CustomerInboundDimensionRow {
  const fix = (m: {
    lastOrderDate: string;
    orderCount?: string;
    orderIntervalStdDev: string;
    orderIntervalMean: string;
    periodicityLabel: string;
  }) => ({
    ...m,
    orderCount: m.orderCount ?? "—",
  });
  return {
    ...row,
    ...fix(row),
    models: row.models.map((mod) => ({
      ...mod,
      ...fix(mod),
      names: mod.names.map((nam) => ({
        ...nam,
        ...fix(nam),
        specs: nam.specs.map((sp) => ({
          ...sp,
          ...fix(sp),
          grammages: sp.grammages.map((gr) => ({
            ...gr,
            ...fix(gr),
          })),
        })),
      })),
    })),
  };
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

  let customerInboundDimension: CustomerInboundDimensionRow[] | null = null;
  if (analysisBase != null && Array.isArray(o.customerInboundDimension)) {
    customerInboundDimension = o.customerInboundDimension
      .map(normalizeCustomerInboundDimensionRow)
      .filter((x): x is CustomerInboundDimensionRow => x !== null)
      .map(withDefaultOrderCountDeep);
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
    customerInboundDimension,
    orderCountComputeCompleted: o.orderCountComputeCompleted === true,
    orderIntervalStdDevComputeCompleted: o.orderIntervalStdDevComputeCompleted === true,
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

export function saveSalesForecastPersisted(
  preview: SalesForecastPreviewPersisted,
  analysisBase: SalesForecastAnalysisPersisted | null,
  orderSegments: OrderSegmentResult | null = null,
  customerInboundDimension: CustomerInboundDimensionRow[] | null = null,
  options?: SaveSalesForecastPersistedOptions,
): boolean {
  const prev = loadSalesForecastPersisted();
  const orderCountComputeCompleted =
    options?.orderCountComputeCompleted !== undefined
      ? options.orderCountComputeCompleted
      : (prev?.orderCountComputeCompleted ?? false);
  const orderIntervalStdDevComputeCompleted =
    options?.orderIntervalStdDevComputeCompleted !== undefined
      ? options.orderIntervalStdDevComputeCompleted
      : (prev?.orderIntervalStdDevComputeCompleted ?? false);
  const payload: PersistedV1 = {
    v: 1,
    preview,
    analysisBase,
    orderSegments,
    customerInboundDimension,
    orderCountComputeCompleted,
    orderIntervalStdDevComputeCompleted,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function readSalesForecastViewTab(): "user" | "debug" | null {
  try {
    const v = localStorage.getItem(VIEW_TAB_STORAGE_KEY);
    if (v === "user" || v === "debug") return v;
  } catch {
    /* ignore */
  }
  return null;
}

export function writeSalesForecastViewTab(tab: "user" | "debug"): void {
  try {
    localStorage.setItem(VIEW_TAB_STORAGE_KEY, tab);
  } catch {
    /* ignore */
  }
}

export function clearSalesForecastPersisted(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(VIEW_TAB_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
