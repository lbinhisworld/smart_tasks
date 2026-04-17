/**
 * @fileoverview 报告「产量看板」数据层：从已保存的提取历史 JSON 中抽取车间日产量，并按分公司 / 全集团聚合。
 *
 * **设计要点**
 * - 解析路径固定为 `production_report → 2. 生产能效… → 2.1 产量达成分析`，键名通过 `findChildBlock` 做模糊匹配，容忍模型键名轻微漂移。
 * - 车间节点下必须存在「当日产量(吨)」或「当日产量」对象，内含计划/实际/偏差等字符串字段；数值经 `parseMetricNumber` 清洗（去单位、逗号、「暂无」）。
 * - 同一提取日、同一分公司下多条历史记录的车间行会先 `mergeWorkshopsByName` 再汇总，避免重复车间双计。
 * - `buildDayCapacityDashboard` 输出 `DayCapacityDashboard`：全量合并后的 `daySummary` 与各 `companies[]`，供 UI 树三级展示。
 *
 * @module productionDashboardMetrics
 */

import type { ExtractionHistoryItem } from "../types/extractionHistory";
import { pickBranchCompany, pickExtractionDate } from "./extractionHistoryGroup";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 当日产量相关聚合指标（单位：吨 / %） */
export interface CapacityMetricSnapshot {
  planTons: number | null;
  actualTons: number | null;
  deviationTons: number | null;
  capacityRatePercent: number | null;
}

export interface WorkshopDayMetrics {
  workshopName: string;
  plan: number | null;
  actual: number | null;
  deviation: number | null;
  ratePercent: number | null;
}

/**
 * 优先使用已解析对象 `parsedJson`；否则尝试解析 `rawModelResponse`，失败返回 `null`。
 * 看板与归档逻辑均依赖此入口，避免各处重复 JSON.parse。
 */
export function getReportJsonRoot(item: ExtractionHistoryItem): Record<string, unknown> | null {
  if (item.parsedJson != null && isRecord(item.parsedJson)) return item.parsedJson;
  try {
    const o = JSON.parse(item.rawModelResponse.trim()) as unknown;
    return isRecord(o) ? o : null;
  } catch {
    return null;
  }
}

/**
 * 将模型返回的中文数字串转为 `number`；无法解析或语义为「暂无」时返回 `null`，聚合时用 `null` 表示缺数而非 0。
 */
export function parseMetricNumber(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t || t === "暂无" || t.includes("暂无")) return null;
  const cleaned = t.replace(/,/g, "").replace(/吨|%/g, "").trim();
  const m = cleaned.match(/-?\d+\.?\d*/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

function addOpt(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

function findChildBlock(
  parent: Record<string, unknown>,
  exactKey: string,
  fuzzy: (k: string) => boolean,
): Record<string, unknown> | null {
  const direct = parent[exactKey];
  if (isRecord(direct)) return direct;
  const alt = Object.keys(parent).find(fuzzy);
  if (alt && isRecord(parent[alt])) return parent[alt] as Record<string, unknown>;
  return null;
}

/**
 * 从 `production_report` 逐级下钻到「2.1 产量达成分析」区块。
 * @returns 以**车间名为键**、车间节点为值的对象；其下再解析「当日产量」结构。找不到任一层则 `null`。
 */
export function findYieldAnalysisSection(root: Record<string, unknown>): Record<string, unknown> | null {
  const pr = root["production_report"];
  if (!isRecord(pr)) return null;
  const sec2 = findChildBlock(pr, "2. 生产能效与财务对撞", (k) => k.includes("生产能效"));
  if (!sec2) return null;
  return findChildBlock(sec2, "2.1 产量达成分析", (k) => k.includes("产量达成"));
}

function extractWorkshopDayMetrics(workshopName: string, v: Record<string, unknown>): WorkshopDayMetrics | null {
  const day =
    (isRecord(v["当日产量(吨)"]) ? v["当日产量(吨)"] : null) ??
    (isRecord(v["当日产量"]) ? v["当日产量"] : null);
  if (!day || !isRecord(day)) return null;
  const plan = parseMetricNumber(day["计划值"]);
  const actual = parseMetricNumber(day["实际值"]);
  let deviation = parseMetricNumber(day["偏差值"]);
  if (deviation == null && plan != null && actual != null) deviation = actual - plan;
  const ratePercent =
    plan != null && plan > 0 && actual != null ? (actual / plan) * 100 : null;
  return { workshopName, plan, actual, deviation, ratePercent };
}

/**
 * 遍历产量达成分析下的每个子键，跳过非对象项，对每个车间构造 `WorkshopDayMetrics`。
 */
export function extractWorkshopsFromRoot(root: Record<string, unknown> | null): WorkshopDayMetrics[] {
  if (!root) return [];
  const yieldSec = findYieldAnalysisSection(root);
  if (!yieldSec) return [];
  const out: WorkshopDayMetrics[] = [];
  for (const [workshopName, node] of Object.entries(yieldSec)) {
    if (!isRecord(node)) continue;
    const m = extractWorkshopDayMetrics(workshopName, node);
    if (m) out.push(m);
  }
  return out;
}

/**
 * 同名车间合并：计划、实际按数值相加；偏差与达成率由合并后的计划/实际**重算**，保证与展示公式一致。
 */
export function mergeWorkshopsByName(rows: WorkshopDayMetrics[]): WorkshopDayMetrics[] {
  const acc = new Map<string, { plan: number | null; actual: number | null }>();
  for (const w of rows) {
    const cur = acc.get(w.workshopName) ?? { plan: null, actual: null };
    acc.set(w.workshopName, {
      plan: addOpt(cur.plan, w.plan),
      actual: addOpt(cur.actual, w.actual),
    });
  }
  return [...acc.entries()].map(([workshopName, { plan, actual }]) => {
    const deviation = plan != null && actual != null ? actual - plan : null;
    const ratePercent =
      plan != null && plan > 0 && actual != null ? (actual / plan) * 100 : null;
    return { workshopName, plan, actual, deviation, ratePercent };
  });
}

/**
 * 多车间行汇总为一张 KPI 卡片：计划/实际为可求和字段之和；偏差 = 实际和 − 计划和；产能率 = 实际和/计划和×100（计划和为 0 时无率）。
 */
export function aggregateWorkshopMetrics(rows: WorkshopDayMetrics[]): CapacityMetricSnapshot {
  let planSum = 0;
  let actualSum = 0;
  let planHit = false;
  let actualHit = false;
  for (const r of rows) {
    if (r.plan != null) {
      planSum += r.plan;
      planHit = true;
    }
    if (r.actual != null) {
      actualSum += r.actual;
      actualHit = true;
    }
  }
  const planTons = planHit ? planSum : null;
  const actualTons = actualHit ? actualSum : null;
  const deviationTons =
    planTons != null && actualTons != null ? actualTons - planTons : null;
  const capacityRatePercent =
    planTons != null && planTons > 0 && actualTons != null
      ? (actualTons / planTons) * 100
      : null;
  return { planTons, actualTons, deviationTons, capacityRatePercent };
}

export interface CompanyCapacityBreakdown {
  companyName: string;
  summary: CapacityMetricSnapshot;
  workshops: WorkshopDayMetrics[];
}

export interface DayCapacityDashboard {
  viewDate: string;
  daySummary: CapacityMetricSnapshot;
  companies: CompanyCapacityBreakdown[];
  hasYieldData: boolean;
}

/**
 * 构建某日「产量看板」完整模型。
 *
 * @param items - 全部提取历史（函数内按 `pickExtractionDate` 过滤 `viewDate`）
 * @param viewDate - 看板当前选择的日历日 YYYY-MM-DD
 * @returns 含集团日汇总、各分公司 summary + workshops；`hasYieldData` 表示该日是否解析到至少一条车间产量
 */
export function buildDayCapacityDashboard(
  items: ExtractionHistoryItem[],
  viewDate: string,
): DayCapacityDashboard {
  const dayItems = items.filter((i) => pickExtractionDate(i) === viewDate);
  const allFlat: WorkshopDayMetrics[] = [];
  const byCompany = new Map<string, WorkshopDayMetrics[]>();

  for (const item of dayItems) {
    const company = pickBranchCompany(item);
    const root = getReportJsonRoot(item);
    const ws = extractWorkshopsFromRoot(root);
    if (!byCompany.has(company)) byCompany.set(company, []);
    byCompany.get(company)!.push(...ws);
    allFlat.push(...ws);
  }

  const mergedDay = mergeWorkshopsByName(allFlat);
  const daySummary = aggregateWorkshopMetrics(mergedDay);

  const companies: CompanyCapacityBreakdown[] = [...byCompany.entries()].map(([companyName, list]) => {
    const merged = mergeWorkshopsByName(list);
    return {
      companyName,
      summary: aggregateWorkshopMetrics(merged),
      workshops: merged,
    };
  });

  companies.sort((a, b) => a.companyName.localeCompare(b.companyName, "zh-CN"));

  const hasYieldData = mergedDay.length > 0;

  return {
    viewDate,
    daySummary,
    companies,
    hasYieldData,
  };
}
