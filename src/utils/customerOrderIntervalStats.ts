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
import {
  listGrammageOrderCountStepsFromBase,
  listOrderIntervalMeanCellPathsTopDown,
  setOrderIntervalMeanOnDimension,
  setPeriodicityLabelOnDimension,
} from "./applyOrderCountToDimension";
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

const CV_STRONG_MAX = 0.3;
const CV_WEAK_MAX = 0.6;

/**
 * 由当前行「订货间隔标准差」「订货间隔平均值」两格**展示串**生成周期性标签（主标签 + 换行 + cv 备注行）。
 * 两者均可解析为有效数且均值为正时 CV=std/mean：≤0.3 强周期；>0.3 且 ≤0.6 弱周期；>0.6 不规则。
 * 无数据或不可算时：主标签为不规则，备注 `cv= -`。
 */
export function buildPeriodicityLabelFromIntervalCells(stdStr: string, meanStr: string): string {
  const stdN = parseOrderIntervalMetricCell(stdStr);
  const meanN = parseOrderIntervalMetricCell(meanStr);
  if (stdN === null || meanN === null || !Number.isFinite(meanN) || meanN <= 0) {
    return "不规则\ncv= -";
  }
  const cv = stdN / meanN;
  const cvLine = `cv=${cv.toFixed(2)}`;
  if (cv <= CV_STRONG_MAX) {
    return `强周期性\n${cvLine}`;
  }
  if (cv <= CV_WEAK_MAX) {
    return `弱周期性\n${cvLine}`;
  }
  return `不规则\n${cvLine}`;
}

export function readOrderIntervalStdMeanAtPath(
  dim: readonly CustomerInboundDimensionRow[],
  path: OrderCountCellPath,
): { orderIntervalStdDev: string; orderIntervalMean: string } {
  for (const c of dim) {
    if (c.customerName !== path.customerName) continue;
    if (path.level === "customer") {
      return { orderIntervalStdDev: c.orderIntervalStdDev, orderIntervalMean: c.orderIntervalMean };
    }
    for (const m of c.models) {
      if (m.model !== path.model) continue;
      if (path.level === "model") {
        return { orderIntervalStdDev: m.orderIntervalStdDev, orderIntervalMean: m.orderIntervalMean };
      }
      for (const n of m.names) {
        if (n.productName !== path.productName) continue;
        if (path.level === "name") {
          return { orderIntervalStdDev: n.orderIntervalStdDev, orderIntervalMean: n.orderIntervalMean };
        }
        for (const sp of n.specs) {
          if (sp.spec !== path.spec) continue;
          if (path.level === "spec") {
            return { orderIntervalStdDev: sp.orderIntervalStdDev, orderIntervalMean: sp.orderIntervalMean };
          }
          for (const gr of sp.grammages) {
            if (gr.grammage === path.grammage) {
              return { orderIntervalStdDev: gr.orderIntervalStdDev, orderIntervalMean: gr.orderIntervalMean };
            }
          }
        }
      }
    }
  }
  return { orderIntervalStdDev: "", orderIntervalMean: "" };
}

export function computePeriodicityLabelForPath(
  dim: readonly CustomerInboundDimensionRow[],
  path: OrderCountCellPath,
): string {
  const { orderIntervalStdDev, orderIntervalMean } = readOrderIntervalStdMeanAtPath(dim, path);
  return buildPeriodicityLabelFromIntervalCells(orderIntervalStdDev, orderIntervalMean);
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

/** 从「订货间隔标准差/平均值」单元格展示串解析为数值；与 {@link formatIntervalDaysStat} 输出可逆对应。 */
export function parseOrderIntervalMetricCell(s: string): number | null {
  const v = (s ?? "").trim();
  if (v === "" || v === "—" || v === "-") return null;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseStdDevCell(s: string): number | null {
  return parseOrderIntervalMetricCell(s);
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

/**
 * 自底表按路径筛行，得到该格「订货间隔的平均值」展示串；与分步/一次性写回同口径。
 */
export function computeOrderIntervalMeanForCellPath(
  allRows: readonly SalesAnalysisBaseRow[],
  path: OrderCountCellPath,
): string {
  const rowsC = filterRowsForCustomer(allRows, path.customerName);
  switch (path.level) {
    case "customer":
      return formatIntervalDaysStat(computeOrderIntervalStatsFromRows(rowsC).meanDays);
    case "model": {
      const rowsM = rowsC.filter((r) => dimModelKey(r) === path.model);
      return formatIntervalDaysStat(computeOrderIntervalStatsFromRows(rowsM).meanDays);
    }
    case "name": {
      const rowsM = rowsC.filter((r) => dimModelKey(r) === path.model);
      const rowsN = rowsM.filter((r) => dimNameKey(r) === path.productName);
      return formatIntervalDaysStat(computeOrderIntervalStatsFromRows(rowsN).meanDays);
    }
    case "spec": {
      const rowsM = rowsC.filter((r) => dimModelKey(r) === path.model);
      const rowsN = rowsM.filter((r) => dimNameKey(r) === path.productName);
      const rowsS = rowsN.filter((r) => dimSpecKey(r) === path.spec);
      return formatIntervalDaysStat(computeOrderIntervalStatsFromRows(rowsS).meanDays);
    }
    case "grammage": {
      const rowsM = rowsC.filter((r) => dimModelKey(r) === path.model);
      const rowsN = rowsM.filter((r) => dimNameKey(r) === path.productName);
      const rowsS = rowsN.filter((r) => dimSpecKey(r) === path.spec);
      const rowsG = rowsS.filter((r) => dimGrammageKey(r) === path.grammage);
      return formatIntervalDaysStat(computeOrderIntervalStatsFromRows(rowsG).meanDays);
    }
  }
}

export function applyOrderIntervalMeanToDimension(
  dim: readonly CustomerInboundDimensionRow[],
  allRows: readonly SalesAnalysisBaseRow[],
): CustomerInboundDimensionRow[] {
  let acc: CustomerInboundDimensionRow[] = dim as CustomerInboundDimensionRow[];
  for (const p of listOrderIntervalMeanCellPathsTopDown(dim)) {
    acc = setOrderIntervalMeanOnDimension(
      acc,
      p,
      computeOrderIntervalMeanForCellPath(allRows, p),
    );
  }
  return acc;
}

/**
 * 按分析树上已填的「订货间隔标准差 / 平均值」格，自下表**同一路径**衍生出的格上写 CV 型周期标签。
 * `allRows` 参数保留以兼容旧调用，可传 `[]`；实际**只读**各节点上 `orderIntervalStdDev` / `orderIntervalMean` 展示串。
 */
export function applyPeriodicityToDimension(
  dim: readonly CustomerInboundDimensionRow[],
  _allRows?: readonly SalesAnalysisBaseRow[],
): CustomerInboundDimensionRow[] {
  let acc: CustomerInboundDimensionRow[] = dim as CustomerInboundDimensionRow[];
  for (const p of listOrderIntervalMeanCellPathsTopDown(dim)) {
    acc = setPeriodicityLabelOnDimension(
      acc,
      p,
      computePeriodicityLabelForPath(dim, p),
    );
  }
  return acc;
}
