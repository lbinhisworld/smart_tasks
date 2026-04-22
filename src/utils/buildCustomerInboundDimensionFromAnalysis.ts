/**
 * 从销售分析底表构建「客户进货周期性分析」用多级树：客户（总体）+ 型号 → 品名 → 规格 → 克重 五级；仅包含有订货记录的组合。
 */

import type { MaterialTag } from "./parseMaterialCode";
import type { SalesAnalysisBaseRow } from "./salesAnalysisBaseFromPreview";

export type CustomerInboundDimensionMetrics = {
  lastOrderDate: string;
  /** 该层级汇总范围内的底表行数（即下单/明细条数） */
  orderCount: string;
  orderIntervalStdDev: string;
  orderIntervalMean: string;
  periodicityLabel: string;
};

/** 维度键缺省、客户名为空时展示为「-」；分析树不保留未解析的型号/品名/规格/克重节点。 */
export const DIM_MISSING_LABEL = "-";

function isParsedDimensionKey(key: string): boolean {
  return (key ?? "").trim() !== "" && key !== DIM_MISSING_LABEL;
}

export type CustomerInboundGrammageRow = {
  grammage: string;
} & CustomerInboundDimensionMetrics;

export type CustomerInboundSpecRow = {
  spec: string;
} & CustomerInboundDimensionMetrics & {
    grammages: CustomerInboundGrammageRow[];
  };

export type CustomerInboundNameRow = {
  productName: string;
} & CustomerInboundDimensionMetrics & {
    specs: CustomerInboundSpecRow[];
  };

export type CustomerInboundModelRow = {
  model: string;
} & CustomerInboundDimensionMetrics & {
    names: CustomerInboundNameRow[];
  };

/** @deprecated 旧版平面 skus，仅用于 localStorage 迁移 */
export type CustomerInboundSkuRow = {
  model: string;
  productName: string;
} & CustomerInboundDimensionMetrics;

export type CustomerInboundDimensionRow = {
  customerName: string;
} & CustomerInboundDimensionMetrics & {
    models: CustomerInboundModelRow[];
  };

function tagText(tags: readonly MaterialTag[], kind: MaterialTag["kind"]): string {
  return (tags.find((x) => x.kind === kind)?.text ?? "").trim();
}

export function dimModelKey(r: SalesAnalysisBaseRow): string {
  return tagText(r.materialTags, "model") || DIM_MISSING_LABEL;
}
export function dimNameKey(r: SalesAnalysisBaseRow): string {
  return tagText(r.materialTags, "name") || DIM_MISSING_LABEL;
}
export function dimSpecKey(r: SalesAnalysisBaseRow): string {
  return tagText(r.materialTags, "spec") || DIM_MISSING_LABEL;
}
export function dimGrammageKey(r: SalesAnalysisBaseRow): string {
  return tagText(r.materialTags, "grammage") || DIM_MISSING_LABEL;
}

function parseDateToMs(s: string): number | null {
  const t = s.trim();
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

function formatYmd(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const mo = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

type DateAcc = { maxMs: number | null; display: string };

function bumpMax(acc: DateAcc, ms: number | null): DateAcc {
  if (ms === null) return acc;
  if (acc.maxMs === null || ms > acc.maxMs) {
    return { maxMs: ms, display: formatYmd(ms) };
  }
  return acc;
}

function metricsFromRows(rows: readonly SalesAnalysisBaseRow[]): CustomerInboundDimensionMetrics {
  const acc = maxDateAccFromRows(rows);
  return {
    lastOrderDate: acc.display || "—",
    orderCount: String(rows.length),
    orderIntervalStdDev: "",
    orderIntervalMean: "",
    periodicityLabel: "",
  };
}

function maxDateAccFromRows(rows: readonly SalesAnalysisBaseRow[]): DateAcc {
  let acc: DateAcc = { maxMs: null, display: "" };
  for (const r of rows) {
    acc = bumpMax(acc, parseDateToMs(r.date));
  }
  return acc;
}

function accToDateOnly(acc: DateAcc): { lastOrderDate: string } {
  return { lastOrderDate: acc.display || "—" };
}

function groupBySortedKeys<T>(items: readonly T[], keyFn: (t: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = keyFn(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(it);
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b, "zh-Hans-CN"));
}

/** 将旧版 skus 迁为五级树（缺省规格/克重占位） */
export function migrateLegacySkusToModels(skus: readonly CustomerInboundSkuRow[]): CustomerInboundModelRow[] {
  const byM = new Map<string, CustomerInboundSkuRow[]>();
  for (const sku of skus) {
    if (!byM.has(sku.model)) byM.set(sku.model, []);
    byM.get(sku.model)!.push(sku);
  }

  return [...byM.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "zh-Hans-CN"))
    .map(([model, mrows]) => {
      const byN = new Map<string, CustomerInboundSkuRow[]>();
      for (const sku of mrows) {
        if (!byN.has(sku.productName)) byN.set(sku.productName, []);
        byN.get(sku.productName)!.push(sku);
      }
      let modelAcc: DateAcc = { maxMs: null, display: "" };
      for (const s of mrows) {
        modelAcc = bumpMax(modelAcc, parseDateToMs(s.lastOrderDate === "—" ? "" : s.lastOrderDate));
      }
      const names: CustomerInboundNameRow[] = [...byN.entries()]
        .sort(([a], [b]) => a.localeCompare(b, "zh-Hans-CN"))
        .map(([productName, nrows]) => {
          const sku0 = nrows[0]!;
          let nameAcc: DateAcc = { maxMs: null, display: "" };
          for (const s of nrows) {
            nameAcc = bumpMax(nameAcc, parseDateToMs(s.lastOrderDate === "—" ? "" : s.lastOrderDate));
          }
          const dm = {
            lastOrderDate: accToDateOnly(nameAcc).lastOrderDate,
            orderCount: String(nrows.length),
            orderIntervalStdDev: sku0.orderIntervalStdDev,
            orderIntervalMean: sku0.orderIntervalMean,
            periodicityLabel: sku0.periodicityLabel,
          };
          return {
            productName,
            ...dm,
            specs: [
              {
                spec: DIM_MISSING_LABEL,
                lastOrderDate: dm.lastOrderDate,
                orderCount: String(nrows.length),
                orderIntervalStdDev: sku0.orderIntervalStdDev,
                orderIntervalMean: sku0.orderIntervalMean,
                periodicityLabel: sku0.periodicityLabel,
                grammages: [
                  {
                    grammage: DIM_MISSING_LABEL,
                    lastOrderDate: sku0.lastOrderDate,
                    orderCount: String(nrows.length),
                    orderIntervalStdDev: sku0.orderIntervalStdDev,
                    orderIntervalMean: sku0.orderIntervalMean,
                    periodicityLabel: sku0.periodicityLabel,
                  },
                ],
              },
            ],
          };
        });

      const m0 = mrows[0]!;
      const mdm = {
        lastOrderDate: accToDateOnly(modelAcc).lastOrderDate,
        orderCount: String(mrows.length),
        orderIntervalStdDev: m0.orderIntervalStdDev,
        orderIntervalMean: m0.orderIntervalMean,
        periodicityLabel: m0.periodicityLabel,
      };
      return {
        model,
        ...mdm,
        names,
      };
    });
}

/**
 * 每个客户一棵型号树；仅当某路径下存在 ≥1 条底表行时才生成该节点（无订货记录不展示）。
 */
export function buildCustomerInboundDimensionFromAnalysis(
  rows: readonly SalesAnalysisBaseRow[],
): CustomerInboundDimensionRow[] {
  const byCustomer = new Map<string, SalesAnalysisBaseRow[]>();
  for (const r of rows) {
    const customerName = (r.customerName ?? "").trim() || DIM_MISSING_LABEL;
    if (!byCustomer.has(customerName)) byCustomer.set(customerName, []);
    byCustomer.get(customerName)!.push(r);
  }

  const out: CustomerInboundDimensionRow[] = (
    [...byCustomer.entries()] as [string, SalesAnalysisBaseRow[]][]
  )
    .sort(([a], [b]) => a.localeCompare(b, "zh-Hans-CN"))
    .map(([customerName, rowsC]) => {
      const models: CustomerInboundModelRow[] = groupBySortedKeys(rowsC, dimModelKey)
        .filter(([model]) => isParsedDimensionKey(model))
        .map(([model, mRows]) => {
          const names: CustomerInboundNameRow[] = groupBySortedKeys(mRows, dimNameKey)
            .filter(([productName]) => isParsedDimensionKey(productName))
            .map(([productName, nRows]) => {
              const specs: CustomerInboundSpecRow[] = groupBySortedKeys(nRows, dimSpecKey)
                .filter(([spec]) => isParsedDimensionKey(spec))
                .map(([spec, sRows]) => {
                  const grammages: CustomerInboundGrammageRow[] = groupBySortedKeys(
                    sRows,
                    dimGrammageKey,
                  )
                    .filter(([grammage]) => isParsedDimensionKey(grammage))
                    .map(([grammage, gRows]) => ({
                      grammage,
                      ...metricsFromRows(gRows),
                    }));
                  if (grammages.length === 0) return null;
                  return {
                    spec,
                    ...metricsFromRows(sRows),
                    grammages,
                  };
                })
                .filter((x): x is CustomerInboundSpecRow => x !== null);
              if (specs.length === 0) return null;
              return {
                productName,
                ...metricsFromRows(nRows),
                specs,
              };
            })
            .filter((x): x is CustomerInboundNameRow => x !== null);
          if (names.length === 0) return null;
          return {
            model,
            ...metricsFromRows(mRows),
            names,
          };
        })
        .filter((x): x is CustomerInboundModelRow => x !== null);

      if (models.length === 0) return null;
      return {
        customerName,
        ...metricsFromRows(rowsC),
        models,
      };
    })
    .filter((x): x is CustomerInboundDimensionRow => x !== null);

  return out;
}
