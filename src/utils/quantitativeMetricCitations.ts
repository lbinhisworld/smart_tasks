/**
 * @fileoverview 保存提取历史时：从 `parsedJson` 叶子中筛出量化指标；字面指标在 `originalText` 中匹配摘录；偏差值/偏差率在同父级含计划值+实际值时视为自动计算，引用条件为计划/实际在正文中的摘录。
 *
 * @module quantitativeMetricCitations
 */

import type { QuantitativeMetricCitation } from "../types/extractionHistory";

const CITATION_RADIUS = 50;
const MAX_ROWS = 400;

/** 不遍历或不作为指标叶子展示的键（元数据、大段正文、范围归属等） */
const SKIP_SUBTREE_KEYS = new Set(["原始内容", "范围"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 视为「量化」叶子：含数字、非「暂无」、非超长叙述、非纯 ISO 日期串 */
export function isQuantitativeLeafValue(s: string): boolean {
  const t = s.trim();
  if (!t || t === "暂无") return false;
  if (t.length > 80) return false;
  if (!/\d/.test(t)) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  return true;
}

function findValueInOriginal(originalText: string, value: string): number {
  const t = originalText;
  const v = value.trim();
  if (!v || v.length < 1) return -1;
  let i = t.indexOf(v);
  if (i >= 0) return i;
  const v2 = v.replace(/\s+/g, " ");
  if (v2 !== v) {
    i = t.indexOf(v2);
    if (i >= 0) return i;
  }
  return -1;
}

function buildExcerpt(
  originalText: string,
  hit: number,
  valueLen: number,
): { excerpt: string; start: number; end: number } {
  const start = Math.max(0, hit - CITATION_RADIUS);
  const end = Math.min(originalText.length, hit + valueLen + CITATION_RADIUS);
  return { excerpt: originalText.slice(start, end), start, end };
}

/** 同父级下「偏差值」「偏差率」且存在计划值/实际值字符串时，按提示词视为自动推算字段 */
function isAutoComputedDeviationLeaf(parentRecord: Record<string, unknown> | null, leafKey: string): boolean {
  if (!parentRecord) return false;
  if (leafKey !== "偏差值" && leafKey !== "偏差率") return false;
  const p = parentRecord["计划值"];
  const a = parentRecord["实际值"];
  return typeof p === "string" && typeof a === "string";
}

function highlightSpanInSlice(
  globalHit: number,
  sliceStart: number,
  valueLen: number,
  prefixLen: number,
  excerptLen: number,
): { start: number; end: number } | null {
  const rel = globalHit - sliceStart;
  if (rel < 0 || rel + valueLen > excerptLen) return null;
  const start = prefixLen + rel;
  const end = start + valueLen;
  return { start, end };
}

/**
 * 自动计算行：用计划值、实际值在正文中的 ±50 字片段作为引用，并标出条件字面区间。
 */
function buildAutoComputedCitation(
  originalText: string,
  row: { path: string; label: string; valueText: string },
  parentRecord: Record<string, unknown>,
): QuantitativeMetricCitation {
  const text = originalText ?? "";
  const planRaw = String(parentRecord["计划值"]).trim();
  const actRaw = String(parentRecord["实际值"]).trim();

  const hitP = findValueInOriginal(text, planRaw);
  const hitA = findValueInOriginal(text, actRaw);

  const highlights: { start: number; end: number }[] = [];

  if (hitP < 0 && hitA < 0) {
    const pv = planRaw.slice(0, 40) + (planRaw.length > 40 ? "…" : "");
    const av = actRaw.slice(0, 40) + (actRaw.length > 40 ? "…" : "");
    return {
      path: row.path,
      metricLabel: row.label,
      valueText: row.valueText,
      sourceKind: "auto_computed",
      matchIndex: -1,
      excerpt: `（自动计算：正文中未找到与计划值「${pv}」或实际值「${av}」一致的连续字面，无法拼接条件引用）`,
      excerptHighlights: [],
    };
  }

  const leftLabel = "计划值（条件）：";
  const sep = "；实际值（条件）：";

  if (hitP >= 0 && hitA >= 0) {
    const ep = buildExcerpt(text, hitP, planRaw.length);
    const ea = buildExcerpt(text, hitA, actRaw.length);
    const excerpt = leftLabel + ep.excerpt + sep + ea.excerpt;
    const h1 = highlightSpanInSlice(hitP, ep.start, planRaw.length, leftLabel.length, ep.excerpt.length);
    const base2 = leftLabel.length + ep.excerpt.length + sep.length;
    const h2 = highlightSpanInSlice(hitA, ea.start, actRaw.length, base2, ea.excerpt.length);
    if (h1) highlights.push(h1);
    if (h2) highlights.push(h2);
    return {
      path: row.path,
      metricLabel: row.label,
      valueText: row.valueText,
      sourceKind: "auto_computed",
      matchIndex: -1,
      excerpt,
      excerptHighlights: highlights,
    };
  }

  if (hitP >= 0) {
    const ep = buildExcerpt(text, hitP, planRaw.length);
    const tail =
      hitA < 0
        ? `（实际值「${actRaw.slice(0, 36)}${actRaw.length > 36 ? "…" : ""}」在正文中未匹配到连续字面）`
        : "";
    const excerpt = leftLabel + ep.excerpt + (tail ? `；${tail}` : "");
    const h1 = highlightSpanInSlice(hitP, ep.start, planRaw.length, leftLabel.length, ep.excerpt.length);
    if (h1) highlights.push(h1);
    return {
      path: row.path,
      metricLabel: row.label,
      valueText: row.valueText,
      sourceKind: "auto_computed",
      matchIndex: -1,
      excerpt,
      excerptHighlights: highlights,
    };
  }

  const ea = buildExcerpt(text, hitA, actRaw.length);
  const rightLabel = "实际值（条件）：";
  const head =
    hitP < 0
      ? `（计划值「${planRaw.slice(0, 36)}${planRaw.length > 36 ? "…" : ""}」在正文中未匹配到连续字面）；`
      : "";
  const excerpt = head + rightLabel + ea.excerpt;
  const baseA = head.length + rightLabel.length;
  const h2 = highlightSpanInSlice(hitA, ea.start, actRaw.length, baseA, ea.excerpt.length);
  if (h2) highlights.push(h2);
  return {
    path: row.path,
    metricLabel: row.label,
    valueText: row.valueText,
    sourceKind: "auto_computed",
    matchIndex: -1,
    excerpt,
    excerptHighlights: highlights,
  };
}

type QuantLeaf = {
  path: string;
  label: string;
  valueText: string;
  parentRecord: Record<string, unknown> | null;
  leafKey: string;
};

function walkQuantitativeLeaves(node: unknown, pathParts: string[], out: QuantLeaf[], parentRecord: Record<string, unknown> | null): void {
  if (out.length >= MAX_ROWS) return;

  if (typeof node === "string") {
    if (!isQuantitativeLeafValue(node)) return;
    const path = pathParts.join(".");
    const label = pathParts[pathParts.length - 1] ?? "value";
    const leafKey = pathParts[pathParts.length - 1] ?? "";
    out.push({ path, label, valueText: node.trim(), parentRecord, leafKey });
    return;
  }

  if (typeof node === "number" && Number.isFinite(node)) {
    const path = pathParts.join(".");
    const label = pathParts[pathParts.length - 1] ?? "value";
    const leafKey = pathParts[pathParts.length - 1] ?? "";
    out.push({ path, label, valueText: String(node), parentRecord, leafKey });
    return;
  }

  if (typeof node === "boolean") return;

  if (Array.isArray(node)) {
    node.forEach((el, i) => {
      walkQuantitativeLeaves(el, [...pathParts, `[${i}]`], out, null);
    });
    return;
  }

  if (!isRecord(node)) return;

  for (const [k, v] of Object.entries(node)) {
    if (SKIP_SUBTREE_KEYS.has(k)) continue;
    walkQuantitativeLeaves(v, [...pathParts, k], out, node);
  }
}

function mergeHighlightRanges(ranges: { start: number; end: number }[]): { start: number; end: number }[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  let cur = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const r = sorted[i];
    if (r.start <= cur.end) cur.end = Math.max(cur.end, r.end);
    else {
      out.push(cur);
      cur = { ...r };
    }
  }
  out.push(cur);
  return out;
}

/**
 * 对当前解析结果与原文，生成量化指标的引用摘录列表（按 JSON 深度优先顺序，最多 {@link MAX_ROWS} 条）。
 */
export function buildQuantitativeMetricCitations(originalText: string, parsedJson: unknown): QuantitativeMetricCitation[] {
  const text = originalText ?? "";
  if (!text.trim() || parsedJson == null) return [];

  const leaves: QuantLeaf[] = [];
  walkQuantitativeLeaves(parsedJson, [], leaves, null);

  const out: QuantitativeMetricCitation[] = [];
  const seenPath = new Set<string>();

  for (const row of leaves) {
    if (seenPath.has(row.path)) continue;
    seenPath.add(row.path);

    if (row.parentRecord && isAutoComputedDeviationLeaf(row.parentRecord, row.leafKey)) {
      out.push(buildAutoComputedCitation(text, row, row.parentRecord));
      continue;
    }

    const hit = findValueInOriginal(text, row.valueText);
    if (hit < 0) {
      out.push({
        path: row.path,
        metricLabel: row.label,
        valueText: row.valueText,
        sourceKind: "literal",
        excerpt: `（原文中未找到与指标值完全一致的连续字面：「${row.valueText.slice(0, 40)}${row.valueText.length > 40 ? "…" : ""}」）`,
        matchIndex: -1,
        excerptStart: undefined,
        excerptEnd: undefined,
        excerptHighlights: [],
      });
      continue;
    }

    const { excerpt, start, end } = buildExcerpt(text, hit, row.valueText.length);
    const relStart = hit - start;
    const relEnd = relStart + row.valueText.length;
    const excerptHighlights =
      relStart >= 0 && relEnd <= excerpt.length ? mergeHighlightRanges([{ start: relStart, end: relEnd }]) : [];

    out.push({
      path: row.path,
      metricLabel: row.label,
      valueText: row.valueText,
      sourceKind: "literal",
      excerpt,
      matchIndex: hit,
      excerptStart: start,
      excerptEnd: end,
      excerptHighlights,
    });
  }

  return out;
}

/** 合并重叠区间，供 UI 渲染引用原文高亮 */
export function mergeExcerptHighlightRanges(ranges: { start: number; end: number }[]): { start: number; end: number }[] {
  return mergeHighlightRanges(ranges);
}
