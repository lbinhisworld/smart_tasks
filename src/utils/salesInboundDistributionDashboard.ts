/**
 * @fileoverview 数据看板「订货单分布」：从销售预测持久化的分析底表按与「生成数量分类」相同规则分档，汇总订单条数；
 * 支持按销售组/业务员、型号/品名、销售组/客户名称钻取。
 *
 * @module salesInboundDistributionDashboard
 */

import { calculateOrderSegments, classifyOrderQuantityLabel, type OrderSegmentLabel, type OrderSegmentResult } from "./calculateOrderSegments";
import type { MaterialTag } from "./parseMaterialCode";
import { loadSalesForecastPersisted } from "./salesForecastStorage";

export type InboundSegmentCounts = {
  high: number;
  low: number;
  fragmented: number;
};

export type SalespersonInboundRow = {
  salesperson: string;
  counts: InboundSegmentCounts;
};

export type SalesTeamInboundRow = {
  salesGroup: string;
  counts: InboundSegmentCounts;
  people: SalespersonInboundRow[];
};

export type MaterialNameInboundRow = {
  /** 品名（来自物料标签 kind=name，缺省为占位文案） */
  name: string;
  counts: InboundSegmentCounts;
};

export type MaterialModelInboundRow = {
  /** 型号（来自物料标签 kind=model） */
  model: string;
  counts: InboundSegmentCounts;
  names: MaterialNameInboundRow[];
};

export type CustomerNameInboundRow = {
  customerName: string;
  counts: InboundSegmentCounts;
};

/** 二级：销售组；三级：客户名称（底表客户名称列） */
export type SalesGroupCustomerInboundRow = {
  salesGroup: string;
  counts: InboundSegmentCounts;
  customers: CustomerNameInboundRow[];
};

export type SalesInboundDistributionModel =
  | { ok: false; reason: string }
  | {
      ok: true;
      fileName: string | null;
      rowCount: number;
      unclassifiedCount: number;
      segmentResult: OrderSegmentResult;
      summary: InboundSegmentCounts;
      teams: SalesTeamInboundRow[];
    };

export type SalesInboundMaterialDistributionModel =
  | { ok: false; reason: string }
  | {
      ok: true;
      fileName: string | null;
      rowCount: number;
      unclassifiedCount: number;
      segmentResult: OrderSegmentResult;
      summary: InboundSegmentCounts;
      models: MaterialModelInboundRow[];
    };

export type SalesInboundDashboardsBundle =
  | { ok: false; reason: string }
  | {
      ok: true;
      fileName: string | null;
      rowCount: number;
      unclassifiedCount: number;
      segmentResult: OrderSegmentResult;
      summary: InboundSegmentCounts;
      teams: SalesTeamInboundRow[];
      models: MaterialModelInboundRow[];
      teamCustomers: SalesGroupCustomerInboundRow[];
    };

function emptyCounts(): InboundSegmentCounts {
  return { high: 0, low: 0, fragmented: 0 };
}

function bump(c: InboundSegmentCounts, label: OrderSegmentLabel) {
  if (label === "高") c.high += 1;
  else if (label === "低") c.low += 1;
  else c.fragmented += 1;
}

function tagText(tags: readonly MaterialTag[], kind: MaterialTag["kind"]): string {
  return (tags.find((x) => x.kind === kind)?.text ?? "").trim();
}

/** 按「高」档订单数降序；相同时按标签名中文排序稳定展示 */
function compareByHighDescThenLabel(
  aLabel: string,
  aHigh: number,
  bLabel: string,
  bHigh: number,
): number {
  if (bHigh !== aHigh) return bHigh - aHigh;
  return aLabel.localeCompare(bLabel, "zh-Hans-CN");
}

/**
 * 一次加载、一次遍历，生成团队/人、型号/品名、销售组/客户 三套钻取数据。
 */
export function buildSalesInboundDashboards(): SalesInboundDashboardsBundle {
  const stored = loadSalesForecastPersisted();
  if (!stored?.analysisBase?.rows?.length) {
    return {
      ok: false,
      reason: "暂无销售分析底表。请在「销售预测」上传 CSV 并点击「拆解物料记录」。",
    };
  }

  const rows = stored.analysisBase.rows;
  const segmentResult = calculateOrderSegments(rows.map((r) => r.quantity));
  const { fragmented_limit: fl, high_limit: hl } = segmentResult.thresholds;
  if (fl === 0 && hl === 0) {
    return {
      ok: false,
      reason: "底表数量列无有效正数，无法分档。请检查数据或在「销售预测」中确认数量列可解析。",
    };
  }

  const summary = emptyCounts();
  let unclassifiedCount = 0;
  const teamMap = new Map<string, Map<string, InboundSegmentCounts>>();
  const teamCustomerMap = new Map<string, Map<string, InboundSegmentCounts>>();
  const modelMap = new Map<string, Map<string, InboundSegmentCounts>>();

  for (const r of rows) {
    const label = classifyOrderQuantityLabel(r.quantity, segmentResult.thresholds);
    if (label === null) {
      unclassifiedCount += 1;
      continue;
    }
    bump(summary, label);

    const g = (r.salesGroup ?? "").trim() || "（未填销售组）";
    const p = (r.salesperson ?? "").trim() || "（未填业务员）";
    if (!teamMap.has(g)) teamMap.set(g, new Map());
    const people = teamMap.get(g)!;
    if (!people.has(p)) people.set(p, emptyCounts());
    bump(people.get(p)!, label);

    const cust = (r.customerName ?? "").trim() || "-";
    if (!teamCustomerMap.has(g)) teamCustomerMap.set(g, new Map());
    const customers = teamCustomerMap.get(g)!;
    if (!customers.has(cust)) customers.set(cust, emptyCounts());
    bump(customers.get(cust)!, label);

    const model = tagText(r.materialTags, "model") || "-";
    const name = tagText(r.materialTags, "name") || "-";
    if (!modelMap.has(model)) modelMap.set(model, new Map());
    const names = modelMap.get(model)!;
    if (!names.has(name)) names.set(name, emptyCounts());
    bump(names.get(name)!, label);
  }

  const teams: SalesTeamInboundRow[] = [...teamMap.entries()]
    .map(([salesGroup, peopleMap]) => {
      const people: SalespersonInboundRow[] = [...peopleMap.entries()]
        .sort(([ka, ca], [kb, cb]) => compareByHighDescThenLabel(ka, ca.high, kb, cb.high))
        .map(([salesperson, counts]) => ({
          salesperson,
          counts: { ...counts },
        }));
      const counts = people.reduce(
        (acc, row) => ({
          high: acc.high + row.counts.high,
          low: acc.low + row.counts.low,
          fragmented: acc.fragmented + row.counts.fragmented,
        }),
        emptyCounts(),
      );
      return { salesGroup, counts, people };
    })
    .sort((a, b) => compareByHighDescThenLabel(a.salesGroup, a.counts.high, b.salesGroup, b.counts.high));

  const teamCustomers: SalesGroupCustomerInboundRow[] = [...teamCustomerMap.entries()]
    .map(([salesGroup, custMap]) => {
      const customers: CustomerNameInboundRow[] = [...custMap.entries()]
        .sort(([ka, ca], [kb, cb]) => compareByHighDescThenLabel(ka, ca.high, kb, cb.high))
        .map(([customerName, counts]) => ({
          customerName,
          counts: { ...counts },
        }));
      const counts = customers.reduce(
        (acc, row) => ({
          high: acc.high + row.counts.high,
          low: acc.low + row.counts.low,
          fragmented: acc.fragmented + row.counts.fragmented,
        }),
        emptyCounts(),
      );
      return { salesGroup, counts, customers };
    })
    .sort((a, b) => compareByHighDescThenLabel(a.salesGroup, a.counts.high, b.salesGroup, b.counts.high));

  const models: MaterialModelInboundRow[] = [...modelMap.entries()]
    .map(([model, namesMap]) => {
      const names: MaterialNameInboundRow[] = [...namesMap.entries()]
        .sort(([ka, ca], [kb, cb]) => compareByHighDescThenLabel(ka, ca.high, kb, cb.high))
        .map(([productName, counts]) => ({
          name: productName,
          counts: { ...counts },
        }));
      const counts = names.reduce(
        (acc, row) => ({
          high: acc.high + row.counts.high,
          low: acc.low + row.counts.low,
          fragmented: acc.fragmented + row.counts.fragmented,
        }),
        emptyCounts(),
      );
      return { model, counts, names };
    })
    .sort((a, b) => compareByHighDescThenLabel(a.model, a.counts.high, b.model, b.counts.high));

  return {
    ok: true,
    fileName: stored.preview?.fileName ?? null,
    rowCount: rows.length,
    unclassifiedCount,
    segmentResult,
    summary,
    teams,
    models,
    teamCustomers,
  };
}

/** @deprecated 内部统一用 buildSalesInboundDashboards；保留供仅需团队维度的调用方 */
export function buildSalesInboundDistributionDashboard(): SalesInboundDistributionModel {
  const b = buildSalesInboundDashboards();
  if (!b.ok) return b;
  return {
    ok: true,
    fileName: b.fileName,
    rowCount: b.rowCount,
    unclassifiedCount: b.unclassifiedCount,
    segmentResult: b.segmentResult,
    summary: b.summary,
    teams: b.teams,
  };
}

/** @deprecated 内部统一用 buildSalesInboundDashboards */
export function buildSalesInboundMaterialDistribution(): SalesInboundMaterialDistributionModel {
  const b = buildSalesInboundDashboards();
  if (!b.ok) return b;
  return {
    ok: true,
    fileName: b.fileName,
    rowCount: b.rowCount,
    unclassifiedCount: b.unclassifiedCount,
    segmentResult: b.segmentResult,
    summary: b.summary,
    models: b.models,
  };
}
