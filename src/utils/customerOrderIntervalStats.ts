/**
 * 从销售分析底表「日期」列计算相邻订单间隔（天）的均值与样本标准差；支持写入客户进货周期性分析多级树。
 */

import type {
  CustomerInboundDimensionRow,
  CustomerInboundGrammageRow,
  CustomerInboundModelRow,
  CustomerInboundNameRow,
  CustomerInboundSpecRow,
} from "./buildCustomerInboundDimensionFromAnalysis";
import {
  DIM_MISSING_LABEL,
  dimGrammageKey,
  dimModelKey,
  dimNameKey,
  dimSpecKey,
} from "./buildCustomerInboundDimensionFromAnalysis";
import type { OrderCountCellPath } from "./applyOrderCountToDimension";
import { listGrammageOrderCountStepsFromBase } from "./applyOrderCountToDimension";
import type { SalesAnalysisBaseRow } from "./salesAnalysisBaseFromPreview";

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

function normalizeCustomerKey(raw: string): string {
  return (raw ?? "").trim() || "-";
}

function localMidnightMs(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function intervalDaysBetweenOrders(prevMs: number, nextMs: number): number {
  return Math.round((localMidnightMs(nextMs) - localMidnightMs(prevMs)) / 86400000);
}

export type CustomerOrderIntervalStats = {
  meanDays: number | null;
  sampleStdDays: number | null;
};

/**
 * 对已筛选行：排序日期 → 相邻间隔天数 → 均值与样本标准差。
 */
export function computeOrderIntervalStatsFromRows(
  rows: readonly SalesAnalysisBaseRow[],
): CustomerOrderIntervalStats {
  const msList: number[] = [];
  for (const r of rows) {
    const ms = parseDateToMs(r.date);
    if (ms !== null) msList.push(ms);
  }
  msList.sort((a, b) => a - b);

  const intervals: number[] = [];
  for (let i = 1; i < msList.length; i++) {
    intervals.push(intervalDaysBetweenOrders(msList[i - 1]!, msList[i]!));
  }

  if (intervals.length === 0) {
    return { meanDays: null, sampleStdDays: null };
  }

  const mean = intervals.reduce((s, x) => s + x, 0) / intervals.length;
  if (intervals.length < 2) {
    return { meanDays: mean, sampleStdDays: null };
  }
  const variance = intervals.reduce((s, x) => s + (x - mean) ** 2, 0) / (intervals.length - 1);
  return { meanDays: mean, sampleStdDays: Math.sqrt(variance) };
}

export function computeCustomerOrderIntervalStats(
  rows: readonly SalesAnalysisBaseRow[],
  customerName: string,
): CustomerOrderIntervalStats {
  const key = normalizeCustomerKey(customerName);
  const rowsC = rows.filter((r) => normalizeCustomerKey(r.customerName) === key);
  return computeOrderIntervalStatsFromRows(rowsC);
}

export function formatIntervalDaysStat(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "";
  return n.toFixed(2);
}

export function suggestPeriodicityLabel(mean: number | null, std: number | null): string {
  if (mean === null || !Number.isFinite(mean) || mean < 0) return "";
  if (std !== null && Number.isFinite(std) && mean > 1e-6) {
    const cv = std / mean;
    if (cv < 0.25) return "间隔较稳定";
    if (cv < 0.55) return "间隔中等波动";
    return "间隔波动较大";
  }
  if (mean <= 10) return "约旬内节奏";
  if (mean <= 45) return "约月级节奏";
  return "长间隔节奏";
}

function filterRowsForCustomer(
  allRows: readonly SalesAnalysisBaseRow[],
  customerName: string,
): SalesAnalysisBaseRow[] {
  const key = normalizeCustomerKey(customerName);
  return allRows.filter((r) => normalizeCustomerKey(r.customerName) === key);
}

function mapGrammages(
  rowsS: readonly SalesAnalysisBaseRow[],
  grammages: readonly CustomerInboundGrammageRow[],
): CustomerInboundGrammageRow[] {
  return grammages.map((gr) => {
    const rowsG = rowsS.filter((r) => dimGrammageKey(r) === gr.grammage);
    return {
      ...gr,
      orderIntervalStdDev: formatIntervalDaysStat(computeOrderIntervalStatsFromRows(rowsG).sampleStdDays),
    };
  });
}

function mapSpecs(rowsN: readonly SalesAnalysisBaseRow[], specs: readonly CustomerInboundSpecRow[]): CustomerInboundSpecRow[] {
  return specs.map((sp) => {
    const rowsS = rowsN.filter((r) => dimSpecKey(r) === sp.spec);
    return {
      ...sp,
      orderIntervalStdDev: formatIntervalDaysStat(computeOrderIntervalStatsFromRows(rowsS).sampleStdDays),
      grammages: mapGrammages(rowsS, sp.grammages),
    };
  });
}

function mapNames(rowsM: readonly SalesAnalysisBaseRow[], names: readonly CustomerInboundNameRow[]): CustomerInboundNameRow[] {
  return names.map((nam) => {
    const rowsN = rowsM.filter((r) => dimNameKey(r) === nam.productName);
    return {
      ...nam,
      orderIntervalStdDev: formatIntervalDaysStat(computeOrderIntervalStatsFromRows(rowsN).sampleStdDays),
      specs: mapSpecs(rowsN, nam.specs),
    };
  });
}

function mapModels(rowsC: readonly SalesAnalysisBaseRow[], models: readonly CustomerInboundModelRow[]): CustomerInboundModelRow[] {
  return models.map((mod) => {
    const rowsM = rowsC.filter((r) => dimModelKey(r) === mod.model);
    return {
      ...mod,
      orderIntervalStdDev: formatIntervalDaysStat(computeOrderIntervalStatsFromRows(rowsM).sampleStdDays),
      names: mapNames(rowsM, mod.names),
    };
  });
}

/**
 * 各级别**独立**从底表行计算间隔样本标准差（与「克重先算、上层对子级标准差取算术平均」的 UI 分轮逻辑不同）。
 * 保留供一次性全量回写或对照；界面「计算订货间隔标准差」使用分轮 API。
 */
export function applyOrderIntervalStdDevToDimension(
  dim: readonly CustomerInboundDimensionRow[],
  allRows: readonly SalesAnalysisBaseRow[],
): CustomerInboundDimensionRow[] {
  return dim.map((cust) => {
    const rowsC = filterRowsForCustomer(allRows, cust.customerName);
    const stdRoot = formatIntervalDaysStat(computeOrderIntervalStatsFromRows(rowsC).sampleStdDays);
    return {
      ...cust,
      orderIntervalStdDev: stdRoot,
      models: mapModels(rowsC, cust.models),
    };
  });
}

function rowsForGrammagePath(
  allRows: readonly SalesAnalysisBaseRow[],
  path: OrderCountCellPath,
): SalesAnalysisBaseRow[] {
  if (path.level !== "grammage") return [];
  const rowsC = filterRowsForCustomer(allRows, path.customerName);
  const rowsM = rowsC.filter((r) => dimModelKey(r) === path.model);
  const rowsN = rowsM.filter((r) => dimNameKey(r) === path.productName);
  const rowsS = rowsN.filter((r) => dimSpecKey(r) === path.spec);
  return rowsS.filter((r) => dimGrammageKey(r) === path.grammage);
}

/**
 * 单克重节点：从底表过滤后计算间隔样本标准差。用于 rAF 分步，使每格算完即写入分析树再渲染。
 */
export function computeOrderIntervalStdDevForGrammagePath(
  allRows: readonly SalesAnalysisBaseRow[],
  path: OrderCountCellPath,
): string {
  if (path.level !== "grammage") return "";
  const rowsG = rowsForGrammagePath(allRows, path);
  return formatIntervalDaysStat(computeOrderIntervalStatsFromRows(rowsG).sampleStdDays);
}

/**
 * 第一轮：仅克重，从底表过滤行后计算间隔的样本标准差（同原 `mapGrammages` 单格逻辑）。
 */
export function listGrammageOrderIntervalStdDevStepsFromBase(
  dim: readonly CustomerInboundDimensionRow[],
  allRows: readonly SalesAnalysisBaseRow[],
): { path: OrderCountCellPath; orderIntervalStdDev: string }[] {
  return listGrammageOrderCountStepsFromBase(dim, allRows).map((step) => ({
    path: step.path,
    orderIntervalStdDev: computeOrderIntervalStdDevForGrammagePath(allRows, step.path),
  }));
}

function parseStdDevCell(s: string): number | null {
  const v = (s ?? "").trim();
  if (v === "" || v === "—" || v === "-") return null;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** 对若干格中可解析为数字的「订货间隔标准差」取算术平均，输出两位小数；无可算项时返回空串。 */
export function averageStdDevDisplayStrings(cells: readonly string[]): string {
  const nums: number[] = [];
  for (const t of cells) {
    const n = parseStdDevCell(t);
    if (n !== null) nums.push(n);
  }
  if (nums.length === 0) return "";
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  return mean.toFixed(2);
}

/**
 * 第二轮起：规格←克重、品名←规格、型号←品名、客户←型号，每层为**直接子节点**格上标准差字符串的**算术平均**。
 * 品名/规格在 {@link orderIntervalStdDevForNamePathWithFallback} / {@link orderIntervalStdDevForSpecPathWithFallback} 中处理。
 */
export function averageOrderIntervalStdDevFromDirectChildren(
  dim: readonly CustomerInboundDimensionRow[],
  path: OrderCountCellPath,
): string {
  switch (path.level) {
    case "grammage":
      return "";
    case "spec": {
      for (const c of dim) {
        if (c.customerName !== path.customerName) continue;
        for (const m of c.models) {
          if (m.model !== path.model) continue;
          for (const n of m.names) {
            if (n.productName !== path.productName) continue;
            const sp = n.specs.find((s) => s.spec === path.spec);
            if (sp) return averageStdDevDisplayStrings(sp.grammages.map((g) => g.orderIntervalStdDev));
            return "";
          }
        }
      }
      return "";
    }
    case "name": {
      for (const c of dim) {
        if (c.customerName !== path.customerName) continue;
        for (const m of c.models) {
          if (m.model !== path.model) continue;
          const nam = m.names.find((n) => n.productName === path.productName);
          if (nam) return averageStdDevDisplayStrings(nam.specs.map((s) => s.orderIntervalStdDev));
          return "";
        }
      }
      return "";
    }
    case "model": {
      for (const c of dim) {
        if (c.customerName !== path.customerName) continue;
        const mod = c.models.find((m) => m.model === path.model);
        if (mod) return averageStdDevDisplayStrings(mod.names.map((n) => n.orderIntervalStdDev));
      }
      return "";
    }
    case "customer": {
      const c = dim.find((r) => r.customerName === path.customerName);
      if (c) return averageStdDevDisplayStrings(c.models.map((m) => m.orderIntervalStdDev));
      return "";
    }
  }
}

function rowsForSpecPathFromBase(
  allRows: readonly SalesAnalysisBaseRow[],
  path: OrderCountCellPath,
): SalesAnalysisBaseRow[] {
  if (path.level !== "spec") return [];
  const rowsC = filterRowsForCustomer(allRows, path.customerName);
  const rowsM = rowsC.filter((r) => dimModelKey(r) === path.model);
  const rowsN = rowsM.filter((r) => dimNameKey(r) === path.productName);
  return rowsN.filter((r) => dimSpecKey(r) === path.spec);
}

function rowsForNamePathFromBase(
  allRows: readonly SalesAnalysisBaseRow[],
  path: OrderCountCellPath,
): SalesAnalysisBaseRow[] {
  if (path.level !== "name") return [];
  const rowsC = filterRowsForCustomer(allRows, path.customerName);
  const rowsM = rowsC.filter((r) => dimModelKey(r) === path.model);
  return rowsM.filter((r) => dimNameKey(r) === path.productName);
}

/**
 * 规格格：若存在未解析克重（「-」）或任一子克重**无**有效标准差显示，则**不从子级取算术平均**，改由销售分析底表按本规格路径全量扫描后计算样本标准差；否则为子级标准差算术平均。
 */
export function orderIntervalStdDevForSpecPathWithFallback(
  dim: readonly CustomerInboundDimensionRow[],
  allRows: readonly SalesAnalysisBaseRow[],
  path: OrderCountCellPath,
): string {
  if (path.level !== "spec") return "";
  for (const c of dim) {
    if (c.customerName !== path.customerName) continue;
    for (const m of c.models) {
      if (m.model !== path.model) continue;
      for (const n of m.names) {
        if (n.productName !== path.productName) continue;
        const sp = n.specs.find((s) => s.spec === path.spec);
        if (!sp) return "";
        const needBaseScan =
          sp.grammages.length === 0 ||
          sp.grammages.some(
            (g) => g.grammage === DIM_MISSING_LABEL || parseStdDevCell(g.orderIntervalStdDev) === null,
          );
        if (needBaseScan) {
          return formatIntervalDaysStat(
            computeOrderIntervalStatsFromRows(rowsForSpecPathFromBase(allRows, path)).sampleStdDays,
          );
        }
        return averageStdDevDisplayStrings(sp.grammages.map((g) => g.orderIntervalStdDev));
      }
    }
  }
  return "";
}

/**
 * 品名格：若存在未解析规格（「-」）或任一子规格**无**有效标准差显示，则**不从子级取算术平均**，改由底表按本品名路径全量扫描；否则为子级标准差算术平均。
 */
export function orderIntervalStdDevForNamePathWithFallback(
  dim: readonly CustomerInboundDimensionRow[],
  allRows: readonly SalesAnalysisBaseRow[],
  path: OrderCountCellPath,
): string {
  if (path.level !== "name") return "";
  for (const c of dim) {
    if (c.customerName !== path.customerName) continue;
    for (const m of c.models) {
      if (m.model !== path.model) continue;
      const nam = m.names.find((n) => n.productName === path.productName);
      if (!nam) return "";
      const needBaseScan =
        nam.specs.length === 0 ||
        nam.specs.some(
          (s) => s.spec === DIM_MISSING_LABEL || parseStdDevCell(s.orderIntervalStdDev) === null,
        );
      if (needBaseScan) {
        return formatIntervalDaysStat(
          computeOrderIntervalStatsFromRows(rowsForNamePathFromBase(allRows, path)).sampleStdDays,
        );
      }
      return averageStdDevDisplayStrings(nam.specs.map((s) => s.orderIntervalStdDev));
    }
  }
  return "";
}

function mapGrammagesMean(
  rowsS: readonly SalesAnalysisBaseRow[],
  grammages: readonly CustomerInboundGrammageRow[],
): CustomerInboundGrammageRow[] {
  return grammages.map((gr) => {
    const rowsG = rowsS.filter((r) => dimGrammageKey(r) === gr.grammage);
    return {
      ...gr,
      orderIntervalMean: formatIntervalDaysStat(computeOrderIntervalStatsFromRows(rowsG).meanDays),
    };
  });
}

function mapSpecsMean(rowsN: readonly SalesAnalysisBaseRow[], specs: readonly CustomerInboundSpecRow[]): CustomerInboundSpecRow[] {
  return specs.map((sp) => {
    const rowsS = rowsN.filter((r) => dimSpecKey(r) === sp.spec);
    return {
      ...sp,
      orderIntervalMean: formatIntervalDaysStat(computeOrderIntervalStatsFromRows(rowsS).meanDays),
      grammages: mapGrammagesMean(rowsS, sp.grammages),
    };
  });
}

function mapNamesMean(rowsM: readonly SalesAnalysisBaseRow[], names: readonly CustomerInboundNameRow[]): CustomerInboundNameRow[] {
  return names.map((nam) => {
    const rowsN = rowsM.filter((r) => dimNameKey(r) === nam.productName);
    return {
      ...nam,
      orderIntervalMean: formatIntervalDaysStat(computeOrderIntervalStatsFromRows(rowsN).meanDays),
      specs: mapSpecsMean(rowsN, nam.specs),
    };
  });
}

function mapModelsMean(rowsC: readonly SalesAnalysisBaseRow[], models: readonly CustomerInboundModelRow[]): CustomerInboundModelRow[] {
  return models.map((mod) => {
    const rowsM = rowsC.filter((r) => dimModelKey(r) === mod.model);
    return {
      ...mod,
      orderIntervalMean: formatIntervalDaysStat(computeOrderIntervalStatsFromRows(rowsM).meanDays),
      names: mapNamesMean(rowsM, mod.names),
    };
  });
}

export function applyOrderIntervalMeanToDimension(
  dim: readonly CustomerInboundDimensionRow[],
  allRows: readonly SalesAnalysisBaseRow[],
): CustomerInboundDimensionRow[] {
  return dim.map((cust) => {
    const rowsC = filterRowsForCustomer(allRows, cust.customerName);
    return {
      ...cust,
      orderIntervalMean: formatIntervalDaysStat(computeOrderIntervalStatsFromRows(rowsC).meanDays),
      models: mapModelsMean(rowsC, cust.models),
    };
  });
}

function mapGrammagesPeriodicity(
  rowsS: readonly SalesAnalysisBaseRow[],
  grammages: readonly CustomerInboundGrammageRow[],
): CustomerInboundGrammageRow[] {
  return grammages.map((gr) => {
    const rowsG = rowsS.filter((r) => dimGrammageKey(r) === gr.grammage);
    const st = computeOrderIntervalStatsFromRows(rowsG);
    return {
      ...gr,
      periodicityLabel: suggestPeriodicityLabel(st.meanDays, st.sampleStdDays),
    };
  });
}

function mapSpecsPeriodicity(rowsN: readonly SalesAnalysisBaseRow[], specs: readonly CustomerInboundSpecRow[]): CustomerInboundSpecRow[] {
  return specs.map((sp) => {
    const rowsS = rowsN.filter((r) => dimSpecKey(r) === sp.spec);
    const st = computeOrderIntervalStatsFromRows(rowsS);
    return {
      ...sp,
      periodicityLabel: suggestPeriodicityLabel(st.meanDays, st.sampleStdDays),
      grammages: mapGrammagesPeriodicity(rowsS, sp.grammages),
    };
  });
}

function mapNamesPeriodicity(rowsM: readonly SalesAnalysisBaseRow[], names: readonly CustomerInboundNameRow[]): CustomerInboundNameRow[] {
  return names.map((nam) => {
    const rowsN = rowsM.filter((r) => dimNameKey(r) === nam.productName);
    const st = computeOrderIntervalStatsFromRows(rowsN);
    return {
      ...nam,
      periodicityLabel: suggestPeriodicityLabel(st.meanDays, st.sampleStdDays),
      specs: mapSpecsPeriodicity(rowsN, nam.specs),
    };
  });
}

function mapModelsPeriodicity(rowsC: readonly SalesAnalysisBaseRow[], models: readonly CustomerInboundModelRow[]): CustomerInboundModelRow[] {
  return models.map((mod) => {
    const rowsM = rowsC.filter((r) => dimModelKey(r) === mod.model);
    const st = computeOrderIntervalStatsFromRows(rowsM);
    return {
      ...mod,
      periodicityLabel: suggestPeriodicityLabel(st.meanDays, st.sampleStdDays),
      names: mapNamesPeriodicity(rowsM, mod.names),
    };
  });
}

export function applyPeriodicityToDimension(
  dim: readonly CustomerInboundDimensionRow[],
  allRows: readonly SalesAnalysisBaseRow[],
): CustomerInboundDimensionRow[] {
  return dim.map((cust) => {
    const rowsC = filterRowsForCustomer(allRows, cust.customerName);
    const st = computeOrderIntervalStatsFromRows(rowsC);
    return {
      ...cust,
      periodicityLabel: suggestPeriodicityLabel(st.meanDays, st.sampleStdDays),
      models: mapModelsPeriodicity(rowsC, cust.models),
    };
  });
}
