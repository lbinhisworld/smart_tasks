/**
 * @fileoverview 「原文引用」与跨页跳转：从日报原文截取与指标相关的片段，并协调报告页 / 历史列表的定位。
 *
 * **设计要点**
 * - 看板侧栏优先展示已保存的 `quantitativeMetricCitations` 中与 KPI 对应的 `excerpt`（`tryBuildCitationFromStoredQuantitative`）；否则回退 `buildQuotedCitationExcerpt`。
 * - `buildQuotedCitationExcerpt`：若传入 `centerOnPhrases` 且在原文可命中，则以该段中心对齐摘录窗口，使点击的指标字面量落在引用中段；否则回退到车间/分公司锚点 + 指标关键词；`jumpNeedle` 须落在原文中。
 * - `pickHistorySourceItem`：同一提取日、同一分公司下可能有多条保存记录；**优先**保留 `originalText` 中含当前 KPI 字面量的条目；打分用正文**开头约 1500 字**解析日历日（避免正文深处「16 日检修」干扰），并与 `viewDate`、日期字面量、短语命中综合择优。
 * - `buildAggregatedDashboardCitation`：看板**加总**指标（集团 / 分公司）点击时，按下属车间逐段拉取引用原文并拼接，高亮区间为各段在合并文中的偏移。
 * - `requestJumpToExtractionHistory`：任务/待安排等场景跳转报告管理并定位历史；`sessionStorage` + `OPEN_REPORTS_PAGE_EVENT` / `EXTRACTION_FOCUS_STORAGE_KEY`。
 *
 * @module reportCitation
 */

import type { ExtractionHistoryItem, QuantitativeMetricCitation } from "../types/extractionHistory";
import { extractDateFromPlainText } from "./extractDateFromText";
import { pickBranchCompany, pickExtractionDate } from "./extractionHistoryGroup";
import {
  extractWorkshopsFromRoot,
  getReportJsonRoot,
} from "./productionDashboardMetrics";
import { mergeExcerptHighlightRanges } from "./quantitativeMetricCitations";

export type CitationMetricId = "capacity" | "plan" | "actual" | "deviation";

export const CITATION_METRIC_LABELS: Record<CitationMetricId, string> = {
  capacity: "当日产能达成",
  plan: "计划达成",
  actual: "实际达成",
  deviation: "偏差值",
};

const METRIC_HINTS: Record<CitationMetricId, readonly string[]> = {
  capacity: ["当日产能", "产能达成", "偏差率", "产量达成", "2.1"],
  plan: ["计划值", "计划达成", "当日产量", "2.1 产量"],
  actual: ["实际值", "当日产量", "2.1"],
  deviation: ["偏差值", "偏差率", "当日产量"],
};

function sliceCore(text: string, center: number, maxLen: number): string {
  if (!text) return "（原文为空）";
  const half = Math.floor(maxLen / 2);
  let start = Math.max(0, center - half);
  let end = Math.min(text.length, start + maxLen);
  if (end - start < maxLen) start = Math.max(0, end - maxLen);
  return text.slice(start, end).trim();
}

/** 正文中可能出现的「看板当前日」字面量（ISO + 中文常见写法），用于择优记录与辅助短语定位。 */
function calendarDateHintsForBodySearch(iso: string): string[] {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return [iso];
  const [, y, mo, d] = m;
  const mi = parseInt(mo, 10);
  const di = parseInt(d, 10);
  return [...new Set([iso, `${y}-${mi}-${di}`, `${y}年${mo}月${d}日`, `${y}年${mi}月${di}日`])];
}

function firstMatchIndexInText(text: string, needles: readonly string[]): number {
  let best = -1;
  for (const n of needles) {
    if (!n) continue;
    const i = text.indexOf(n);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}

/**
 * 在全文查找「点击指标」对应的字面量，用于把摘录窗口居中到该段。
 * 短语按长度优先；同一短语多处出现时选离 `preferNearIndex`（车间/分公司）最近，并可用 `secondaryPreferIndex`（正文中报告日期）加权。
 */
function findPhraseSpanForCitationCenter(
  text: string,
  phrases: readonly string[],
  preferNearIndex: number,
  secondaryPreferIndex?: number,
): { start: number; end: number } | null {
  if (!phrases.length || !text) return null;
  const sorted = [...new Set(phrases.map((p) => p.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);

  const collectOccurrences = (needle: string): { start: number; end: number }[] => {
    const out: { start: number; end: number }[] = [];
    if (!needle) return out;
    let pos = 0;
    while (pos < text.length) {
      const i = text.indexOf(needle, pos);
      if (i < 0) break;
      out.push({ start: i, end: i + needle.length });
      pos = i + 1;
    }
    return out;
  };

  const needleVariants = (p: string): string[] => {
    const set = new Set<string>([p]);
    const noComma = p.replace(/,/g, "");
    if (noComma !== p) set.add(noComma);
    return [...set];
  };

  const pickOccurrence = (occ: { start: number; end: number }[]): { start: number; end: number } => {
    if (occ.length === 1) return occ[0];
    const hasSecondary = secondaryPreferIndex != null && secondaryPreferIndex >= 0;
    if (preferNearIndex < 0 && !hasSecondary) return occ[0];
    let best = occ[0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const o of occ) {
      const mid = o.start + (o.end - o.start) / 2;
      let d = 0;
      if (preferNearIndex >= 0) d += Math.abs(mid - preferNearIndex);
      if (secondaryPreferIndex != null && secondaryPreferIndex >= 0) {
        d += 0.4 * Math.abs(mid - secondaryPreferIndex);
      }
      if (d < bestDist) {
        bestDist = d;
        best = o;
      }
    }
    return best;
  };

  for (const p of sorted) {
    for (const needle of needleVariants(p)) {
      const occ = collectOccurrences(needle);
      if (occ.length === 0) continue;
      return pickOccurrence(occ);
    }
  }
  return null;
}

/** 仅看正文开头（标题/汇总日期区），避免全文里「明日(16日)」等计划用语被当成报告日。 */
const CITATION_LEADING_CHARS = 1500;

function extractLeadingReportCalendarDate(text: string): string | null {
  const head = text.slice(0, CITATION_LEADING_CHARS);
  return extractDateFromPlainText(head);
}

/**
 * 若 KPI 短语里存在足够具体的字面量，则只保留原文包含该串的记录，避免 JSON 提取日为 16 但正文仍是 15 日汇总被选入。
 */
function filterItemsContainingMetricPhrase(
  items: ExtractionHistoryItem[],
  preferPhrases: readonly string[],
): ExtractionHistoryItem[] {
  if (!preferPhrases.length) return items;
  const sorted = [...preferPhrases].map((x) => x.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const p of sorted) {
    if (p.length < 5 && !/\d/.test(p)) continue;
    const hits = items.filter((it) => (it.originalText ?? "").includes(p));
    if (hits.length > 0) return hits;
    const nc = p.replace(/,/g, "");
    if (nc !== p && nc.length >= 4) {
      const hits2 = items.filter((it) => (it.originalText ?? "").includes(nc));
      if (hits2.length > 0) return hits2;
    }
  }
  return items;
}

/** 多条候选时，优先与看板「当前日」正文一致且含 KPI 字面量的那条。 */
function scoreHistoryItemForCitation(
  item: ExtractionHistoryItem,
  viewDate: string,
  preferPhrases: readonly string[],
): number {
  const t = item.originalText ?? "";
  if (!t) return 0;
  let s = 0;
  const head = t.slice(0, CITATION_LEADING_CHARS);
  const leadingDate = extractLeadingReportCalendarDate(t);
  if (leadingDate === viewDate) s += 560;
  else if (leadingDate != null && leadingDate !== viewDate) s -= 520;

  for (const hint of calendarDateHintsForBodySearch(viewDate)) {
    if (head.includes(hint)) s += 160;
  }
  if (preferPhrases.length) {
    const sorted = [...preferPhrases].map((x) => x.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
    for (const p of sorted) {
      if (t.includes(p)) {
        s += 120 + Math.min(p.length, 28);
        break;
      }
      const nc = p.replace(/,/g, "");
      if (nc !== p && t.includes(nc)) {
        s += 100 + Math.min(nc.length, 28);
        break;
      }
    }
  }
  const root = getReportJsonRoot(item);
  if (extractWorkshopsFromRoot(root).length > 0) s += 8;
  return s;
}

function pickBestHistoryItemByCitationScore(
  items: ExtractionHistoryItem[],
  viewDate: string,
  preferPhrases: readonly string[],
): ExtractionHistoryItem {
  const pool = filterItemsContainingMetricPhrase(items, preferPhrases);
  const work = pool.length > 0 ? pool : items;
  if (work.length <= 1) return work[0];
  let best = work[0];
  let bestS = scoreHistoryItemForCitation(best, viewDate, preferPhrases);
  for (let k = 1; k < work.length; k++) {
    const sk = scoreHistoryItemForCitation(work[k], viewDate, preferPhrases);
    if (sk > bestS) {
      bestS = sk;
      best = work[k];
    }
  }
  return best;
}

/** 在原文中取最长且真实存在的候选短语（含去逗号变体），用于跳转/黄标。 */
function pickLongestPresentPhraseInText(text: string, phrases: readonly string[]): string | null {
  if (!phrases.length || !text) return null;
  const sorted = [...new Set(phrases.map((p) => p.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const p of sorted) {
    if (text.includes(p)) return p;
    const nc = p.replace(/,/g, "");
    if (nc !== p && text.includes(nc)) return nc;
  }
  return null;
}

/** 指标关键词按长度降序，取首个在原文中出现的，避免短串（如「2.1」）抢先匹配错误段落。 */
function pickLongestPresentHintInText(text: string, hints: readonly string[]): string | null {
  const sorted = [...hints].sort((a, b) => b.length - a.length);
  for (const h of sorted) {
    if (text.includes(h)) return h;
  }
  return null;
}

/**
 * 在日报原文中截取与指标相关的约 `maxLen` 字片段，并生成跳转用 `jumpNeedle`。
 *
 * @param originalText - 单条历史中的原始正文
 * @param opts.metric - 决定关键词表 `METRIC_HINTS` 与上下文语义
 * @param opts.workshopName - 可选；优先在原文中定位车间名
 * @param opts.companyName - 可选；车间未命中时用分公司名锚定（兼容 `·` 与 `/` 差异）
 * @param opts.centerOnPhrases - 与看板点击格一致的数值/单位字面量；若能在原文中命中，则摘录以该段**几何中心**对齐，使指标落在引用中段、前后保留其它原文
 * @param opts.viewDate - 看板当前提取日 `YYYY-MM-DD`；用于在原文中定位报告日期字面量，辅助多命中时的短语选择
 * @param opts.maxLen - 摘录最大字符数；传入 `centerOnPhrases` 时建议 ≥ 240 以便两侧上下文充足
 * @returns `quoted` 为带省略号的展示串；`jumpNeedle` **必须为原文中真实子串**，优先与点击指标字面量一致，供历史「原始数据」黄标与滚动定位
 */
/** 回退摘录（带「。。。」包裹）内，用短语找红字高亮区间。 */
export function findHighlightRangeInQuoted(
  quoted: string,
  phrases: readonly string[],
): { start: number; end: number } | null {
  if (phrases.length === 0) return null;
  const sorted = [...phrases].map((p) => p.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const p of sorted) {
    const i = quoted.indexOf(p);
    if (i >= 0) return { start: i, end: i + p.length };
  }
  for (const p of sorted) {
    const noComma = p.replace(/,/g, "");
    if (noComma === p) continue;
    const i = quoted.indexOf(noComma);
    if (i >= 0) return { start: i, end: i + noComma.length };
  }
  return null;
}

const AGGREGATED_CITATION_BLOCK_SEP = "\n\n────────────────\n\n";

/** 报告看板加总指标：每一下级车间一条摘录，用于「原文引用」合并展示。 */
export type AggregatedCitationSegment = {
  companyName: string;
  workshopName: string;
  highlightPhrases: readonly string[];
};

/**
 * 将多个车间在「同一指标」下的引用摘录合并为一段侧栏正文。
 */
export function buildAggregatedDashboardCitation(
  history: ExtractionHistoryItem[],
  viewDate: string,
  metric: CitationMetricId,
  segments: AggregatedCitationSegment[],
  opts: { scope: "group" | "company" },
): {
  quotedExcerpt: string;
  citationHighlightRanges: { start: number; end: number }[];
  sourceItemId: string | null;
  jumpNeedle: string;
} | null {
  if (segments.length === 0) return null;

  let acc = "";
  const allRanges: { start: number; end: number }[] = [];
  let primarySourceId: string | null = null;
  let primaryJumpNeedle = "";

  for (let i = 0; i < segments.length; i++) {
    if (i > 0) acc += AGGREGATED_CITATION_BLOCK_SEP;
    const seg = segments[i]!;
    const header =
      opts.scope === "group"
        ? `【${seg.companyName} · ${seg.workshopName}】\n`
        : `【${seg.workshopName}】\n`;
    acc += header;
    const bodyStart = acc.length;

    const source = pickHistorySourceItem(
      history,
      viewDate,
      seg.companyName,
      seg.workshopName,
      seg.highlightPhrases,
    );
    if (!source) {
      acc += "（未找到该车间对应的提取记录或原文。）";
      continue;
    }
    if (primarySourceId == null) primarySourceId = source.id;

    const text = source.originalText ?? "";
    const phrases = [...seg.highlightPhrases];
    const stored = tryBuildCitationFromStoredQuantitative(source, metric, seg.workshopName, phrases);
    let body: string;
    let localRanges: { start: number; end: number }[];
    let needle: string;
    if (stored) {
      body = stored.quotedExcerpt;
      localRanges = stored.citationHighlightRanges.map((r) => ({
        start: bodyStart + r.start,
        end: bodyStart + r.end,
      }));
      needle = stored.jumpNeedle;
    } else {
      const { quoted, jumpNeedle } = buildQuotedCitationExcerpt(text, {
        metric,
        workshopName: seg.workshopName,
        companyName: seg.companyName,
        centerOnPhrases: phrases,
        maxLen: 280,
        viewDate,
      });
      body = quoted;
      const single = findHighlightRangeInQuoted(quoted, phrases);
      localRanges = single ? [{ start: bodyStart + single.start, end: bodyStart + single.end }] : [];
      needle = jumpNeedle;
    }
    if (!primaryJumpNeedle) primaryJumpNeedle = needle;
    acc += body;
    allRanges.push(...localRanges);
  }

  const trimmed = acc.trim();
  if (!trimmed) return null;

  return {
    quotedExcerpt: acc,
    citationHighlightRanges: mergeExcerptHighlightRanges(allRanges),
    sourceItemId: primarySourceId,
    jumpNeedle: primaryJumpNeedle || "计划值",
  };
}

export function buildQuotedCitationExcerpt(
  originalText: string,
  opts: {
    metric: CitationMetricId;
    workshopName?: string | null;
    companyName?: string | null;
    maxLen?: number;
    /** 与 KPI 展示一致的字符串列表，用于居中窗口与高亮（由看板生成） */
    centerOnPhrases?: readonly string[];
    /** 看板日期选择器当前日，与正文「汇总日期」对齐时摘录更准确 */
    viewDate?: string;
  },
): { quoted: string; jumpNeedle: string } {
  const centerPhrases = opts.centerOnPhrases ?? [];
  const hasCenter = centerPhrases.length > 0;
  const maxLen = opts.maxLen ?? (hasCenter ? 260 : 200);
  const text = originalText || "";
  let anchor = -1;
  const ws = opts.workshopName?.trim();
  const co = opts.companyName?.trim();
  if (ws) {
    anchor = text.indexOf(ws);
    if (anchor < 0) anchor = text.indexOf(ws.replace(/\s/g, ""));
  }
  if (anchor < 0 && co) {
    anchor = text.indexOf(co);
    if (anchor < 0) anchor = text.indexOf(co.replace(/·/g, ""));
  }

  const hints = METRIC_HINTS[opts.metric];
  let hit = -1;
  const searchFrom = anchor >= 0 ? Math.max(0, anchor - 800) : 0;
  const searchTo = anchor >= 0 ? Math.min(text.length, anchor + 800) : text.length;
  const sliceWindow = text.slice(searchFrom, searchTo);
  for (const h of hints) {
    const i = sliceWindow.indexOf(h);
    if (i >= 0) {
      hit = searchFrom + i;
      break;
    }
  }
  if (hit < 0 && anchor >= 0) hit = anchor;
  if (hit < 0) {
    const i21 = text.indexOf("2.1");
    hit = i21 >= 0 ? i21 : 0;
  }

  const dateHints = opts.viewDate ? calendarDateHintsForBodySearch(opts.viewDate) : [];
  const headForViewDate = text.slice(0, 2000);
  const dateIdx =
    opts.viewDate && dateHints.length > 0 ? firstMatchIndexInText(headForViewDate, dateHints) : -1;
  const span = hasCenter
    ? findPhraseSpanForCitationCenter(
        text,
        centerPhrases,
        anchor,
        dateIdx >= 0 ? dateIdx : undefined,
      )
    : null;
  const centerChar =
    span != null
      ? span.start + Math.floor((span.end - span.start) / 2)
      : hit + Math.min(20, Math.floor(maxLen / 4));

  const core = sliceCore(text, centerChar, maxLen);
  const compact = core.replace(/\s+/g, " ").trim();
  const compactNeedle =
    compact.length >= 12
      ? compact.slice(0, 24)
      : compact.slice(0, Math.max(6, Math.min(compact.length, 12))) || "当日产量";

  const fromSpan = span != null ? text.slice(span.start, span.end) : null;
  const fromPhrases = hasCenter && !fromSpan ? pickLongestPresentPhraseInText(text, centerPhrases) : null;
  const fromCompact = text.includes(compactNeedle) && compactNeedle.length >= 6 ? compactNeedle : null;
  const fromHints = pickLongestPresentHintInText(text, hints);

  const jumpNeedle =
    (fromSpan != null && fromSpan.length >= 2 ? fromSpan : null) ??
    (fromPhrases != null && fromPhrases.length >= 2 ? fromPhrases : null) ??
    fromCompact ??
    (fromHints != null && fromHints.length >= 4 ? fromHints : null) ??
    pickLongestPresentPhraseInText(text, centerPhrases) ??
    (text.includes(compactNeedle) && compactNeedle.length >= 4 ? compactNeedle : null) ??
    pickLongestPresentHintInText(text, hints) ??
    "计划值";

  const quoted = `"。。。${core}。。。"`;
  return { quoted, jumpNeedle };
}

/**
 * 为看板某一格选取**一条**用于「原文引用」侧栏的历史记录。
 *
 * @param companyName - `null`/空/`全集团汇总` 时走集团分支：优先含 2.1 产量数据的记录
 * @param workshopName - 非空时在分公司候选中优先匹配含该车间的 JSON
 * @param preferPhrases - 与当前点击 KPI 一致的字面量；用于在多条同分公司记录中择优（正文日期 + 数值命中）
 */
export function pickHistorySourceItem(
  history: ExtractionHistoryItem[],
  viewDate: string,
  companyName: string | null,
  workshopName: string | null,
  preferPhrases?: readonly string[],
): ExtractionHistoryItem | null {
  const phrases = preferPhrases ?? [];
  const dayItems = history.filter((i) => pickExtractionDate(i) === viewDate);
  if (dayItems.length === 0) return null;
  if (companyName == null || companyName === "" || companyName === "全集团汇总") {
    const withYield = dayItems.filter((i) => extractWorkshopsFromRoot(getReportJsonRoot(i)).length > 0);
    const pool = withYield.length > 0 ? withYield : dayItems;
    return pickBestHistoryItemByCitationScore(pool, viewDate, phrases);
  }
  const branch = dayItems.filter((i) => pickBranchCompany(i) === companyName);
  if (branch.length === 0) return null;
  if (workshopName) {
    const matches = branch.filter((it) => {
      const ws = extractWorkshopsFromRoot(getReportJsonRoot(it));
      return ws.some((w) => w.workshopName === workshopName);
    });
    const pool = matches.length > 0 ? matches : branch;
    return pickBestHistoryItemByCitationScore(pool, viewDate, phrases);
  }
  return pickBestHistoryItemByCitationScore(branch, viewDate, phrases);
}

export const OPEN_REPORTS_PAGE_EVENT = "smart-tasks:open-reports";
export const EXTRACTION_FOCUS_STORAGE_KEY = "smart_tasks_pending_extraction_focus";

/** 看板 KPI 与「引用提取」叶子 `metricLabel` 对应关系（产量块内） */
function citationLeafLabelForMetric(metric: CitationMetricId): string {
  switch (metric) {
    case "plan":
      return "计划值";
    case "actual":
      return "实际值";
    case "deviation":
      return "偏差值";
    case "capacity":
      return "偏差率";
    default:
      return "";
  }
}

function scoreCitationRowAgainstPhrases(row: QuantitativeMetricCitation, phrases: readonly string[]): number {
  if (!phrases.length) return 0;
  const vt = row.valueText.trim();
  let best = 0;
  for (const p of phrases) {
    const pt = p.trim();
    if (!pt) continue;
    if (pt === vt) best = Math.max(best, 220);
    else if (pt.includes(vt) || vt.includes(pt)) best = Math.max(best, 90);
    else {
      const nc = pt.replace(/,/g, "");
      const ncv = vt.replace(/,/g, "");
      if (nc === ncv || nc.includes(ncv) || ncv.includes(nc)) best = Math.max(best, 70);
    }
  }
  return best;
}

/**
 * 在单条提取历史的「引用提取」结果中，选取与看板当前点击指标最匹配的一行（同日同记录内多车间时按车间名 + 数值短语打分）。
 */
export function pickStoredQuantitativeCitation(
  item: ExtractionHistoryItem,
  metric: CitationMetricId,
  workshopName: string | null,
  highlightPhrases: readonly string[],
): QuantitativeMetricCitation | null {
  const rows = item.quantitativeMetricCitations;
  if (!rows?.length) return null;
  const leaf = citationLeafLabelForMetric(metric);
  let candidates = rows.filter((r) => r.metricLabel === leaf && r.path.includes("当日产量"));
  if (candidates.length === 0) return null;
  const wn = workshopName?.trim();
  if (wn) {
    const byWs = candidates.filter((r) => r.path.includes(wn));
    if (byWs.length) candidates = byWs;
  }
  if (candidates.length === 1) return candidates[0];
  let best = candidates[0];
  let bestS = scoreCitationRowAgainstPhrases(best, highlightPhrases);
  for (let i = 1; i < candidates.length; i++) {
    const s = scoreCitationRowAgainstPhrases(candidates[i], highlightPhrases);
    if (s > bestS) {
      bestS = s;
      best = candidates[i];
    }
  }
  return best;
}

function excerptHighlightsForStoredRow(row: QuantitativeMetricCitation): { start: number; end: number }[] {
  if (row.excerptHighlights?.length) return mergeExcerptHighlightRanges(row.excerptHighlights);
  const text = row.excerpt;
  if (row.matchIndex >= 0 && typeof row.excerptStart === "number") {
    const s = row.matchIndex - row.excerptStart;
    const e = s + row.valueText.length;
    if (s >= 0 && e <= text.length) return [{ start: s, end: e }];
  }
  const i = text.indexOf(row.valueText);
  if (i >= 0) return [{ start: i, end: i + row.valueText.length }];
  return [];
}

/** 跳转原文用：优先指标值字面，否则选点击短语中在正文中存在的最长串 */
export function pickDashboardJumpNeedle(
  originalText: string,
  row: QuantitativeMetricCitation | null,
  highlightPhrases: readonly string[],
): string {
  const t = originalText ?? "";
  if (row) {
    const vt = row.valueText.trim();
    if (vt && t.includes(vt)) return vt;
  }
  const sorted = [...new Set(highlightPhrases.map((x) => x.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const p of sorted) {
    if (t.includes(p)) return p;
    const nc = p.replace(/,/g, "");
    if (nc !== p && t.includes(nc)) return nc;
  }
  return sorted[0] ?? "计划值";
}

/**
 * 若该条历史已有「引用提取」且能匹配当前看板指标，则侧栏直接展示对应行的 `excerpt` 与高亮区间；否则返回 `null` 由调用方回退 `buildQuotedCitationExcerpt`。
 */
export function tryBuildCitationFromStoredQuantitative(
  source: ExtractionHistoryItem,
  metric: CitationMetricId,
  workshopName: string | null,
  highlightPhrases: readonly string[],
): { quotedExcerpt: string; citationHighlightRanges: { start: number; end: number }[]; jumpNeedle: string } | null {
  const row = pickStoredQuantitativeCitation(source, metric, workshopName, highlightPhrases);
  if (!row) return null;
  const len = row.excerpt.length;
  const rawRanges = excerptHighlightsForStoredRow(row);
  const citationHighlightRanges = mergeExcerptHighlightRanges(
    rawRanges.filter((r) => r.start >= 0 && r.end <= len && r.end > r.start),
  );
  return {
    quotedExcerpt: row.excerpt,
    citationHighlightRanges,
    jumpNeedle: pickDashboardJumpNeedle(source.originalText ?? "", row, highlightPhrases),
  };
}

/** 原文引用侧栏展示数据（不含回调） */
export interface ReportCitationPayload {
  viewDate: string;
  displayCompany: string;
  metricLabel: string;
  quotedExcerpt: string;
  sourceItemId: string | null;
  jumpNeedle: string;
  /**
   * 在 `quotedExcerpt` 内的半开区间列表，对用户点击的 KPI 相关字面做红字 + 闪烁红框。
   * 优先来自提取记录 `quantitativeMetricCitations`；回退摘录时由看板短语在摘录内匹配得到。
   */
  citationHighlightRanges: { start: number; end: number }[];
}

/**
 * 从看板「查看原文」跳转到报告管理页并聚焦某条提取历史：写入 `sessionStorage` 后派发全局事件。
 * 接收方应读取 `EXTRACTION_FOCUS_STORAGE_KEY` 并在渲染后根据 `needle` 滚动/高亮正文。
 *
 * @param id - `ExtractionHistoryItem.id`
 * @param needle - 须在 `originalText` 中出现的子串（通常来自引用提取对应行的 `valueText` 或 `buildQuotedCitationExcerpt`）
 */
export function requestJumpToExtractionHistory(id: string, needle: string): void {
  try {
    sessionStorage.setItem(EXTRACTION_FOCUS_STORAGE_KEY, JSON.stringify({ id, needle }));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(OPEN_REPORTS_PAGE_EVENT));
}
