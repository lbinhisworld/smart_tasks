/**
 * 从客户进货周期性分析树中抽取「强周期性 / 弱周期性」行，供「进货周期性模式挖掘」展示。
 */

import {
  dimGrammageKey,
  dimModelKey,
  dimNameKey,
  dimSpecKey,
} from "./buildCustomerInboundDimensionFromAnalysis";
import type { CustomerInboundDimensionRow } from "./buildCustomerInboundDimensionFromAnalysis";
import { parseOrderIntervalMetricCell } from "./customerOrderIntervalStats";
import { parseQuantityNumberString } from "./parseQuantityNumber";
import type { MaterialTagKind } from "./parseMaterialCode";
import type { SalesAnalysisBaseRow } from "./salesAnalysisBaseFromPreview";

/** 与底表「物料标签」列同款的型号/品名/规格/克重四段（总体无标签行，用 isProductScopeTotal） */
export type InboundProductMaterialTag = {
  kind: Extract<MaterialTagKind, "model" | "name" | "spec" | "grammage">;
  text: string;
};

/** 与当前模式子卡片路径一致的底表行，按时间排序后的采购时间线节点 */
export type InboundPurchaseTimelineNode = {
  date: string;
  quantity: string;
};

export type InboundPeriodicityPatternItem = {
  key: string;
  customerName: string;
  /** 底表该路径下众数「业务员」 */
  salesName: string;
  /** 客户维度「总体」路径时为 true，此时不输出四段标签，UI 以「总体」+ id 色展示 */
  isProductScopeTotal: boolean;
  productMaterialTags: readonly InboundProductMaterialTag[];
  lastShipDate: string;
  /** CV 展示（来自周期标签次行或重算） */
  cv: string;
  orderIntervalMean: string;
  periodicityLabel: string;
  nextOrderDate: string;
  avgOrderQty: string;
  /** 当前客户 + 参数路径下底表行展开的采购时间线（按日期升序） */
  purchaseTimeline: readonly InboundPurchaseTimelineNode[];
};

function normalizeCustomerKey(raw: string): string {
  return (raw ?? "").trim() || "-";
}

function filterRowsForCustomer(
  allRows: readonly SalesAnalysisBaseRow[],
  customerName: string,
): SalesAnalysisBaseRow[] {
  const key = normalizeCustomerKey(customerName);
  return allRows.filter((r) => normalizeCustomerKey(r.customerName) === key);
}

function filterByPath(
  base: readonly SalesAnalysisBaseRow[],
  p: { model: string; name?: string; spec?: string; grammage?: string },
): SalesAnalysisBaseRow[] {
  let r = base.filter((x) => dimModelKey(x) === p.model);
  if (p.name !== undefined) r = r.filter((x) => dimNameKey(x) === p.name);
  if (p.spec !== undefined) r = r.filter((x) => dimSpecKey(x) === p.spec);
  if (p.grammage !== undefined) r = r.filter((x) => dimGrammageKey(x) === p.grammage);
  return r;
}

const PLACE = "—";

function productMaterialTags4(
  model: string,
  name: string,
  spec: string,
  grammage: string,
): readonly InboundProductMaterialTag[] {
  return [
    { kind: "model", text: model || PLACE },
    { kind: "name", text: name || PLACE },
    { kind: "spec", text: spec || PLACE },
    { kind: "grammage", text: grammage || PLACE },
  ];
}

function mainPeriodicityLine(periodicityLabel: string): string {
  return (periodicityLabel ?? "").trim().split("\n")[0]!.trim() ?? "";
}

function shouldInclude(periodicityLabel: string): boolean {
  const m = mainPeriodicityLine(periodicityLabel);
  return m === "强周期性" || m === "弱周期性";
}

function parseCvFromLabel(periodicityLabel: string, stdStr: string, meanStr: string): string {
  const lines = (periodicityLabel ?? "").split("\n");
  const sub = (lines[1] ?? "").trim();
  const m = sub.match(/cv=([\d.+\-eE]+| -)/i);
  if (m) {
    const t = m[1]!.trim();
    if (t === "-" || t === "—") return "—";
    const n = parseFloat(t);
    return Number.isFinite(n) ? n.toFixed(2) : t;
  }
  const a = parseOrderIntervalMetricCell(stdStr);
  const b = parseOrderIntervalMetricCell(meanStr);
  if (a === null || b === null || b <= 0) return "—";
  return (a / b).toFixed(2);
}

/** 用于排序：可解析的 CV 为有限数，缺失或无效为 +∞，保证排在末尾 */
function cvDisplayToSortValue(cv: string): number {
  const t = (cv ?? "").trim();
  if (t === "" || t === "—" || t === "-") return Number.POSITIVE_INFINITY;
  const n = parseFloat(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

function parseYmdToLocalMs(ymd: string): number | null {
  const t = (ymd ?? "").trim();
  if (!t || t === "—" || t === "-") return null;
  const s = t.replace(/\//g, "-");
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.getTime();
}

/** 与维树/间隔统计一致：底表「单据日期」展示串 → 可排序时间戳 */
function parseAnalysisRowDateMs(s: string): number | null {
  const t = (s ?? "").trim();
  if (!t) return null;
  const slash = t.replace(/\//g, "-");
  let n = Date.parse(slash);
  if (!Number.isNaN(n)) return n;
  const m = t.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (m) {
    n = Date.parse(`${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function buildPurchaseTimelineFromBaseRows(
  rows: readonly SalesAnalysisBaseRow[],
): InboundPurchaseTimelineNode[] {
  const decorated = rows.map((r, index) => ({
    r,
    ms: parseAnalysisRowDateMs(r.date),
    index,
  }));
  decorated.sort((a, b) => {
    if (a.ms !== null && b.ms !== null && a.ms !== b.ms) return a.ms - b.ms;
    if (a.ms !== null && b.ms === null) return -1;
    if (a.ms === null && b.ms !== null) return 1;
    return a.index - b.index;
  });
  return decorated.map(({ r }) => ({
    date: (r.date ?? "").trim() || "—",
    quantity: (r.quantity ?? "").trim() || "—",
  }));
}

function formatYmdLocal(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const mo = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function estimateNextOrderDate(lastShip: string, meanStr: string): string {
  const base = parseYmdToLocalMs(lastShip);
  const days = parseOrderIntervalMetricCell(meanStr);
  if (base === null || days === null || days <= 0) return "—";
  const next = base + Math.round(days) * 86400000;
  return formatYmdLocal(next);
}

function dominantSalesName(rows: readonly SalesAnalysisBaseRow[]): string {
  if (rows.length === 0) return "—";
  const count = new Map<string, number>();
  for (const r of rows) {
    const s = (r.salesperson ?? "").trim() || "—";
    count.set(s, (count.get(s) ?? 0) + 1);
  }
  let best = "—";
  let n = 0;
  for (const [k, c] of count) {
    if (c > n) {
      n = c;
      best = k;
    }
  }
  return best;
}

function averageQuantity(rows: readonly SalesAnalysisBaseRow[]): string {
  const nums: number[] = [];
  for (const r of rows) {
    const q = parseQuantityNumberString(r.quantity);
    if (q !== null && Number.isFinite(q) && q >= 0) nums.push(q);
  }
  if (nums.length === 0) return "—";
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return avg.toFixed(2);
}

function pushItem(
  out: InboundPeriodicityPatternItem[],
  args: {
    key: string;
    customerName: string;
    rows: readonly SalesAnalysisBaseRow[];
    isProductScopeTotal: boolean;
    productMaterialTags: readonly InboundProductMaterialTag[];
    lastOrderDate: string;
    orderIntervalStdDev: string;
    orderIntervalMean: string;
    periodicityLabel: string;
  },
) {
  out.push({
    key: args.key,
    customerName: args.customerName,
    salesName: dominantSalesName(args.rows),
    isProductScopeTotal: args.isProductScopeTotal,
    productMaterialTags: args.productMaterialTags,
    lastShipDate: args.lastOrderDate.trim() || "—",
    cv: parseCvFromLabel(args.periodicityLabel, args.orderIntervalStdDev, args.orderIntervalMean),
    orderIntervalMean: (args.orderIntervalMean ?? "").trim() || "—",
    periodicityLabel: (args.periodicityLabel ?? "").trim() || "—",
    nextOrderDate: estimateNextOrderDate(args.lastOrderDate, args.orderIntervalMean),
    avgOrderQty: averageQuantity(args.rows),
    purchaseTimeline: buildPurchaseTimelineFromBaseRows(args.rows),
  });
}

/**
 * 抽取树中**所有**主标签为强/弱周期性的节点（含客户/型号/品名/规格/克重各层），
 * 用底表路径行计算业务员与平均量。
 */
export function listInboundPeriodicityPatterns(
  dim: readonly CustomerInboundDimensionRow[],
  baseRows: readonly SalesAnalysisBaseRow[],
): InboundPeriodicityPatternItem[] {
  const out: InboundPeriodicityPatternItem[] = [];
  for (const cust of dim) {
    const rowsC = filterRowsForCustomer(baseRows, cust.customerName);
    if (shouldInclude(cust.periodicityLabel)) {
      pushItem(out, {
        key: `${cust.customerName}|c`,
        customerName: cust.customerName,
        rows: rowsC,
        isProductScopeTotal: true,
        productMaterialTags: [],
        lastOrderDate: cust.lastOrderDate,
        orderIntervalStdDev: cust.orderIntervalStdDev,
        orderIntervalMean: cust.orderIntervalMean,
        periodicityLabel: cust.periodicityLabel,
      });
    }
    for (const mod of cust.models) {
      const rowsM = filterByPath(rowsC, { model: mod.model });
      if (shouldInclude(mod.periodicityLabel)) {
        pushItem(out, {
          key: `${cust.customerName}|m|${mod.model}`,
          customerName: cust.customerName,
          rows: rowsM,
          isProductScopeTotal: false,
          productMaterialTags: productMaterialTags4(mod.model, PLACE, PLACE, PLACE),
          lastOrderDate: mod.lastOrderDate,
          orderIntervalStdDev: mod.orderIntervalStdDev,
          orderIntervalMean: mod.orderIntervalMean,
          periodicityLabel: mod.periodicityLabel,
        });
      }
      for (const nameR of mod.names) {
        const rowsN = filterByPath(rowsC, { model: mod.model, name: nameR.productName });
        if (shouldInclude(nameR.periodicityLabel)) {
          pushItem(out, {
            key: `${cust.customerName}|m|${mod.model}|n|${nameR.productName}`,
            customerName: cust.customerName,
            rows: rowsN,
            isProductScopeTotal: false,
            productMaterialTags: productMaterialTags4(mod.model, nameR.productName, PLACE, PLACE),
            lastOrderDate: nameR.lastOrderDate,
            orderIntervalStdDev: nameR.orderIntervalStdDev,
            orderIntervalMean: nameR.orderIntervalMean,
            periodicityLabel: nameR.periodicityLabel,
          });
        }
        for (const specR of nameR.specs) {
          const rowsS = filterByPath(rowsC, {
            model: mod.model,
            name: nameR.productName,
            spec: specR.spec,
          });
          if (shouldInclude(specR.periodicityLabel)) {
            pushItem(out, {
              key: `${cust.customerName}|m|${mod.model}|n|${nameR.productName}|s|${specR.spec}`,
              customerName: cust.customerName,
              rows: rowsS,
              isProductScopeTotal: false,
              productMaterialTags: productMaterialTags4(mod.model, nameR.productName, specR.spec, PLACE),
              lastOrderDate: specR.lastOrderDate,
              orderIntervalStdDev: specR.orderIntervalStdDev,
              orderIntervalMean: specR.orderIntervalMean,
              periodicityLabel: specR.periodicityLabel,
            });
          }
          for (const g of specR.grammages) {
            const rowsG = filterByPath(rowsC, {
              model: mod.model,
              name: nameR.productName,
              spec: specR.spec,
              grammage: g.grammage,
            });
            if (shouldInclude(g.periodicityLabel)) {
              pushItem(out, {
                key: `${cust.customerName}|m|${mod.model}|n|${nameR.productName}|s|${specR.spec}|g|${g.grammage}`,
                customerName: cust.customerName,
                rows: rowsG,
                isProductScopeTotal: false,
                productMaterialTags: productMaterialTags4(
                  mod.model,
                  nameR.productName,
                  specR.spec,
                  g.grammage,
                ),
                lastOrderDate: g.lastOrderDate,
                orderIntervalStdDev: g.orderIntervalStdDev,
                orderIntervalMean: g.orderIntervalMean,
                periodicityLabel: g.periodicityLabel,
              });
            }
          }
        }
      }
    }
  }
  out.sort((a, b) => {
    const da = cvDisplayToSortValue(a.cv);
    const db = cvDisplayToSortValue(b.cv);
    if (da !== db) return da - db;
    return a.key.localeCompare(b.key, "zh-Hans-CN");
  });
  return out;
}
