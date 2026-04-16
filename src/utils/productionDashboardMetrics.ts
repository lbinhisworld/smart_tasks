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

export function getReportJsonRoot(item: ExtractionHistoryItem): Record<string, unknown> | null {
  if (item.parsedJson != null && isRecord(item.parsedJson)) return item.parsedJson;
  try {
    const o = JSON.parse(item.rawModelResponse.trim()) as unknown;
    return isRecord(o) ? o : null;
  } catch {
    return null;
  }
}

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

/** 从 production_report 中定位「2.1 产量达成分析」对象（键名允许轻微漂移） */
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

/** 同名车间计划/实际相加（同日多条记录时） */
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
