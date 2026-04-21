/**
 * @fileoverview 进货/销售数量分档：按累计进货量界定零散界（从小到大累至 10% 总量）与高价值界（从大到小累至 70% 总量），及小样本均值 fallback。
 *
 * @module calculateOrderSegments
 */

import { parsePositiveQuantityFromCell } from "./parseQuantityNumber";

export type OrderSegmentLabel = "高" | "低" | "零散";

export type OrderSegmentResult = {
  thresholds: {
    /** 数量严格小于此值（或业务约定 ≤ 分界）视为零散；与 UI 展示一致采用 &lt; */
    fragmented_limit: number;
    /** 数量严格大于此值视为高；中间区间为低 */
    high_limit: number;
  };
  segment_logic: {
    /** 按单笔数量升序累计，达到总进货量该比例时的单笔数量作为零散界 */
    fragmented_volume_contribution_pct: 10;
    /** 按单笔数量降序累计，达到总进货量该比例时的单笔数量作为高价值界 */
    high_volume_contribution_pct: 70;
  };
};

const MIN_SAMPLES_FOR_MAIN = 10;
const FRAGMENTED_P = 0.1;
const HIGH_VOLUME_CUM_P = 0.7;

function computeMainThresholds(valid: number[]): { fragmented: number; high: number } {
  const sortedAsc = [...valid].sort((a, b) => a - b);
  const sortedDesc = [...valid].sort((a, b) => b - a);
  const total = sortedAsc.reduce((s, x) => s + x, 0);

  let fragmentedRaw = sortedAsc[0] ?? 0;
  let highRaw = sortedDesc[0] ?? 0;
  if (total > 0) {
    let cumAsc = 0;
    for (const q of sortedAsc) {
      cumAsc += q;
      fragmentedRaw = q;
      if (cumAsc / total >= FRAGMENTED_P) break;
    }
    let cumDesc = 0;
    for (const q of sortedDesc) {
      cumDesc += q;
      highRaw = q;
      if (cumDesc / total >= HIGH_VOLUME_CUM_P) break;
    }
  }

  return {
    fragmented: Math.round(fragmentedRaw),
    high: Math.round(highRaw),
  };
}

/** 有效条数 &lt; MIN_SAMPLES_FOR_MAIN 时：基于均值的 fallback */
function computeFallbackThresholds(valid: number[]): { fragmented: number; high: number } {
  const mean = valid.reduce((s, x) => s + x, 0) / valid.length;
  let fragmented = Math.round(mean * 0.5);
  let high = Math.round(mean * 1.5);
  if (fragmented < 1) fragmented = 1;
  if (high <= fragmented) high = fragmented + 1;
  return { fragmented, high };
}

function normalizeOrder(f: number, h: number): { fragmented_limit: number; high_limit: number } {
  let fragmented_limit = f;
  let high_limit = h;
  if (!Number.isFinite(fragmented_limit)) fragmented_limit = 0;
  if (!Number.isFinite(high_limit)) high_limit = 0;
  if (high_limit < fragmented_limit) high_limit = fragmented_limit;
  if (high_limit === fragmented_limit) high_limit = fragmented_limit + 1;
  return { fragmented_limit, high_limit };
}

/**
 * 按与 UI 一致的规则打标签：零散为严格小于零散界；低为两界闭区间；高为严格大于高价值界。
 * 非正或无法解析的数量返回 null（不进入三档）。
 */
export function classifyOrderQuantityLabel(
  raw: unknown,
  thresholds: { fragmented_limit: number; high_limit: number },
): OrderSegmentLabel | null {
  const q = parsePositiveQuantityFromCell(raw);
  if (q === null) return null;
  const { fragmented_limit: fl, high_limit: hl } = thresholds;
  if (q < fl) return "零散";
  if (q > hl) return "高";
  return "低";
}

/**
 * @param rawQuantities - 与业务表「数量」列一致：可为字符串或数字；解析时识别千分位与美式/欧式小数；0、负数、非数字、空会剔除。
 */
export function calculateOrderSegments(rawQuantities: readonly unknown[]): OrderSegmentResult {
  const valid: number[] = [];
  for (const x of rawQuantities) {
    const n = parsePositiveQuantityFromCell(x);
    if (n !== null) valid.push(n);
  }

  if (valid.length === 0) {
    return {
      thresholds: { fragmented_limit: 0, high_limit: 0 },
      segment_logic: { fragmented_volume_contribution_pct: 10, high_volume_contribution_pct: 70 },
    };
  }

  const { fragmented, high } =
    valid.length < MIN_SAMPLES_FOR_MAIN ? computeFallbackThresholds(valid) : computeMainThresholds(valid);

  const thresholds = normalizeOrder(fragmented, high);

  return {
    thresholds,
    segment_logic: { fragmented_volume_contribution_pct: 10, high_volume_contribution_pct: 70 },
  };
}
