/**
 * 弱进货周期模式：当订货间隔 CV > 0.3 时，众数检测 → 否则 P25～P75 区间；再按需做时间衰减（×1.2）预警修正。
 */

import { parseOrderIntervalMetricCell } from "./customerOrderIntervalStats";
import type { InboundPeriodicityPatternItem } from "./inboundPeriodicityPatternMining";
import { parseQuantityNumberString } from "./parseQuantityNumber";

export type WeakPatternNextQtyPrediction =
  | {
      ok: true;
      kind: "mode";
      predictedQty: number;
      predictionLogicZh: string;
      timeDecayApplied: boolean;
      sampleCount: number;
    }
  | {
      ok: true;
      kind: "interval";
      minVolume: number;
      maxVolume: number;
      predictionLogicZh: string;
      timeDecayApplied: boolean;
      sampleCount: number;
    }
  | { ok: false; reason: string };

/** 弱周期量预测启用条件：订货间隔 CV 须严格大于该值 */
const WEAK_PATTERN_CV_THRESHOLD = 0.3;

function parseTimelineDateMs(s: string): number | null {
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

function localMidnightMs(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function parseCvInterval(cv: string): number | null {
  const t = (cv ?? "").trim();
  if (t === "" || t === "—" || t === "-") return null;
  const n = parseFloat(String(t).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** 线性插值分位数，p ∈ [0, 1]；sortedAsc 须已升序。 */
function quantileLinear(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return NaN;
  if (n === 1) return sortedAsc[0]!;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  if (lo === hi) return sortedAsc[lo]!;
  return sortedAsc[lo]! + (h - lo) * (sortedAsc[hi]! - sortedAsc[lo]!);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function predictNextOrderQuantityWeakPattern(
  item: InboundPeriodicityPatternItem,
): WeakPatternNextQtyPrediction {
  const cvVal = parseCvInterval(item.cv);
  if (cvVal === null) {
    return {
      ok: false,
      reason: `CV 不可解析，未满足弱周期预测条件（需 CV > ${WEAK_PATTERN_CV_THRESHOLD}）`,
    };
  }
  if (cvVal <= WEAK_PATTERN_CV_THRESHOLD) {
    return {
      ok: false,
      reason: `订货间隔 CV 为 ${cvVal.toFixed(2)}，未超过 ${WEAK_PATTERN_CV_THRESHOLD}，不启用弱周期量预测`,
    };
  }

  const entries: { ms: number; qty: number }[] = [];
  for (const node of item.purchaseTimeline) {
    const ms = parseTimelineDateMs(node.date);
    const qty = parseQuantityNumberString(node.quantity);
    if (ms !== null && qty !== null && qty > 0) {
      entries.push({ ms, qty });
    }
  }

  if (entries.length === 0) {
    return { ok: false, reason: "无有效数量可解析的订单" };
  }

  const quantities = entries.map((e) => e.qty);
  const n = quantities.length;
  const sortedQty = [...quantities].sort((a, b) => a - b);

  const freq = new Map<number, number>();
  for (const q of quantities) {
    const k = round2(q);
    freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  let modeVal: number | null = null;
  let modeCount = 0;
  for (const [val, c] of freq) {
    if (c > modeCount) {
      modeCount = c;
      modeVal = val;
    }
  }

  const strictHalf = n * 0.5;
  const useMode = modeVal !== null && modeCount > strictHalf;

  let kind: "mode" | "interval";
  let predictedQty = 0;
  let minVolume = 0;
  let maxVolume = 0;

  if (useMode) {
    kind = "mode";
    predictedQty = modeVal!;
  } else {
    kind = "interval";
    minVolume = quantileLinear(sortedQty, 0.25);
    maxVolume = quantileLinear(sortedQty, 0.75);
    if (!Number.isFinite(minVolume) || !Number.isFinite(maxVolume) || minVolume > maxVolume) {
      return { ok: false, reason: "分位数计算无效" };
    }
  }

  const meanIntervalDays = parseOrderIntervalMetricCell(item.orderIntervalMean);
  const lastMs = Math.max(...entries.map((e) => e.ms));
  const todayMidnight = localMidnightMs(Date.now());
  const lastMidnight = localMidnightMs(lastMs);
  const daysSinceLast = Math.round((todayMidnight - lastMidnight) / 86400000);

  let timeDecayApplied = false;
  if (
    meanIntervalDays !== null &&
    meanIntervalDays > 0 &&
    daysSinceLast > 2 * meanIntervalDays
  ) {
    timeDecayApplied = true;
    if (kind === "mode") {
      predictedQty = round2(predictedQty * 1.2);
    } else {
      minVolume = round2(minVolume * 1.2);
      maxVolume = round2(maxVolume * 1.2);
    }
  }

  const parts: string[] = [];
  parts.push(
    `弱周期预测前提：订货间隔变异系数 CV 为 ${cvVal.toFixed(2)}（> ${WEAK_PATTERN_CV_THRESHOLD}），在 ${n} 笔有效订单量上计算。`,
  );

  if (kind === "mode") {
    const pct = ((modeCount / n) * 100).toFixed(1);
    parts.push(
      `众数检测：数量按两位小数归并后，众数 ${modeVal!.toFixed(2)} 吨出现 ${modeCount} 次，占 ${pct}%，超过 50%，采用众数作为预测采购量基点。`,
    );
  } else {
    parts.push(
      `未出现单一数量占比超过 50% 的众数，采用概率区间模式：历史订单量的 25% 分位数至 75% 分位数作为预测区间（P25～P75）。`,
    );
  }

  if (timeDecayApplied) {
    const meanStr = meanIntervalDays!.toFixed(2);
    const thrStr = (2 * meanIntervalDays!).toFixed(2);
    parts.push(
      `时间衰减修正：最近一次有效下单距今 ${daysSinceLast} 天，订货间隔均值 ${meanStr} 天，已超过 2 倍均值（${thrStr} 天），对预测值整体上浮 20% 作为预警。`,
    );
  }

  const predictionLogicZh = parts.join("\n");

  if (kind === "mode") {
    return {
      ok: true,
      kind: "mode",
      predictedQty,
      predictionLogicZh,
      timeDecayApplied,
      sampleCount: n,
    };
  }
  return {
    ok: true,
    kind: "interval",
    minVolume,
    maxVolume,
    predictionLogicZh,
    timeDecayApplied,
    sampleCount: n,
  };
}
