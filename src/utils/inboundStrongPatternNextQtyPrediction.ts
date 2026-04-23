/**
 * 强进货周期模式：基于最近 5 笔订单量预测下一次下单量（物流模式 / 加权模式）。
 */

import type { InboundPurchaseTimelineNode } from "./inboundPeriodicityPatternMining";
import { parseQuantityNumberString } from "./parseQuantityNumber";

export type StrongPatternNextQtyPrediction =
  | {
      ok: true;
      predictedQty: number;
      mode: "logistics" | "weighted";
      historicalMean: number;
      historicalStdDev: number;
      sampleCount: number;
      /** 为何选用物流/加权模式（不含具体预测吨数，避免与「下一次量预测」重复） */
      predictionLogicZh: string;
      hasDeviationWarning: boolean;
    }
  | { ok: false; reason: string };

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

function median(nums: number[]): number {
  if (nums.length === 0) return NaN;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid]!;
  return (s[mid - 1]! + s[mid]!) / 2;
}

function sampleStdDev(values: number[], mean: number): number {
  const n = values.length;
  if (n < 2) return 0;
  let sum = 0;
  for (const v of values) {
    const d = v - mean;
    sum += d * d;
  }
  return Math.sqrt(sum / (n - 1));
}

/**
 * 从采购时间线（与模式卡片路径一致、按日期升序）取最近 5 笔可解析正数量，执行策略 A/B。
 */
export function predictNextOrderQuantityFromPurchaseTimeline(
  timeline: readonly InboundPurchaseTimelineNode[],
): StrongPatternNextQtyPrediction {
  const decorated = timeline
    .map((node) => ({
      ms: parseTimelineDateMs(node.date),
      qty: parseQuantityNumberString(node.quantity),
    }))
    .filter((x) => x.ms !== null && x.qty !== null && x.qty > 0) as { ms: number; qty: number }[];

  decorated.sort((a, b) => b.ms - a.ms);
  const recent = decorated.slice(0, 5);
  const q = recent.map((x) => x.qty);
  const n = q.length;

  if (n === 0) {
    return { ok: false, reason: "无有效数量可解析的订单" };
  }

  const mean = q.reduce((a, b) => a + b, 0) / n;
  const std = sampleStdDev(q, mean);

  let mode: "logistics" | "weighted";
  let predictedQty: number;

  const threshold80 = Math.ceil(0.8 * n);
  const withinCount =
    mean > 0 ? q.filter((qq) => Math.abs(qq - mean) / mean <= 0.05).length : 0;

  const useLogistics = mean > 0 && withinCount >= threshold80;

  let predictionLogicZh: string;

  if (useLogistics) {
    mode = "logistics";
    predictedQty = median(q);
    predictionLogicZh =
      `对最近 ${n} 笔有效订单量计算均值后，有 ${withinCount} 笔的订单量相对均值偏离不超过 ±5%，` +
      `已达到「至少 ${threshold80} 笔（不少于 80%）」的收敛判定，可认为进货量波动小。` +
      `因此采用物流模式：用这 ${n} 笔数量的中位数作为预测依据。`;
  } else {
    mode = "weighted";
    if (n >= 3) {
      predictedQty = q[0]! * 0.4 + q[1]! * 0.3 + q[2]! * 0.3;
    } else if (n === 2) {
      predictedQty = q[0]! * 0.5 + q[1]! * 0.5;
    } else {
      predictedQty = q[0]!;
    }
    const weightedDetail =
      n >= 3
        ? "对最近三笔按 0.4、0.3、0.3 加权（越近权重越大）。"
        : n === 2
          ? "仅有两笔时按 0.5、0.5 平均。"
          : "仅一笔有效订单时只能以该笔为参考。";

    predictionLogicZh =
      mean > 0
        ? `对最近 ${n} 笔有效订单量，仅有 ${withinCount} 笔落在相对均值 ±5% 的波动带内，` +
          `未达到「至少 ${threshold80} 笔（不少于 80%）」的阈值，判定波动较大。` +
          `因此采用加权模式：${weightedDetail}`
        : `有效样本均值为 0 或无法用于相对偏离判定，按加权模式处理：${weightedDetail}`;
  }

  if (!Number.isFinite(predictedQty)) {
    return { ok: false, reason: "预测值无效" };
  }

  const hasDeviationWarning =
    mean > 0 && Math.abs(predictedQty - mean) / mean > 0.3;

  return {
    ok: true,
    predictedQty,
    mode,
    historicalMean: mean,
    historicalStdDev: std,
    sampleCount: n,
    predictionLogicZh,
    hasDeviationWarning,
  };
}
