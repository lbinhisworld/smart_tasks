/**
 * @fileoverview 报告主题：按模型给出的提取日期、分公司名称筛选提取历史条目。
 */

import type { ExtractionHistoryItem } from "../types/extractionHistory";
import { pickExtractionDate, resolveBranchLabelForHistoryItem } from "./extractionHistoryGroup";

function normBranch(s: string): string {
  return s.trim().replace(/[/\\]/g, "·");
}

/** 用户或模型常说「××公司」，存储多为「××分公司」——双向扩展筛选项，避免范围误判为空。 */
function expandBranchFilters(branches: string[]): string[] {
  const out: string[] = [];
  for (const raw of branches) {
    const t = normBranch(raw);
    if (!t) continue;
    out.push(t);
    if (/公司$/.test(t) && !/分公司$/.test(t)) {
      out.push(t.replace(/公司$/, "分公司"));
    }
  }
  return [...new Set(out)];
}

/**
 * 日期、分公司均为空时：**不限制**该两维，返回全部 `items`（由调用方先做视角可见性过滤）。
 * 任一维有值时按 AND 过滤（未给出的维度不限制）；若无命中则回退全量再截断至 maxItems 条。
 */
export function filterExtractionHistoryByReportScope(
  items: ExtractionHistoryItem[],
  reportDates: string[],
  branchCompanies: string[],
  maxItems = 8,
): ExtractionHistoryItem[] {
  const dates = [...new Set(reportDates.map((d) => d.trim()).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))];
  const branches = expandBranchFilters([...new Set(branchCompanies.map(normBranch).filter(Boolean))]);
  const scopeFullyUnspecified = dates.length === 0 && branches.length === 0;

  const matchWithDates = (dateList: string[], list: ExtractionHistoryItem[]) =>
    list.filter((h) => {
      const d = pickExtractionDate(h);
      const b = normBranch(resolveBranchLabelForHistoryItem(h));
      const dateOk = dateList.length === 0 || dateList.some((x) => d === x);
      const branchOk =
        branches.length === 0 ||
        branches.some((x) => b === x || b.includes(x) || x.includes(b) || b.replace(/·/g, "") === x.replace(/·/g, ""));
      return dateOk && branchOk;
    });

  const matched = matchWithDates(dates, items);

  const out = matched.length > 0 ? matched : [...items];
  const cap = scopeFullyUnspecified ? out.length : maxItems;
  return out.slice(0, cap);
}

function pad2(n: string): string {
  return n.length >= 2 ? n : `0${n}`;
}

/** 问题中是否出现明确年份（`YYYY年…` 或 ISO `YYYY-MM-DD`）。 */
export function questionHasExplicitCalendarYear(question: string): boolean {
  const q = question.trim();
  return /\d{4}\s*年/.test(q) || /\b\d{4}-\d{2}-\d{2}\b/.test(q);
}

/** 问题中所有「M月D日」对应的 `MM-DD`（与 `pickExtractionDate` 的 `slice(5)` 一致）。 */
export function extractMonthDayKeysFromQuestion(question: string): string[] {
  const q = question.trim();
  const keys = new Set<string>();
  const re = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q)) !== null) {
    keys.add(`${pad2(m[1])}-${pad2(m[2])}`);
  }
  return [...keys];
}

export type ResolveReportDatesAgainstHistoryResult = {
  report_dates: string[];
  /** 用户问题里带了日期意图，但本机可见提取历史中没有任何一条的「提取日期」能满足该意图 */
  stalemateNoExtractDate: boolean;
};

/**
 * 将「数据范围」里的日期与**本机可见**提取历史的 `提取日期` 严格对齐，不臆造年份。
 * - 问题中只有「M月D日」、无明确年份：仅保留历史中真实存在的、月日匹配的 ISO 日期（可能 0/1/多条）。
 * - 问题中有明确年份或 ISO：以模型输出 + 问句中显式日期为候选，再 **intersect** 本机已有日期。
 */
export function resolveReportDatesAgainstVisibleHistory(
  question: string,
  scopeReportDates: string[],
  items: ExtractionHistoryItem[],
): ResolveReportDatesAgainstHistoryResult {
  const q = question.trim();
  const available = [
    ...new Set(
      items
        .map((h) => pickExtractionDate(h))
        .filter((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())),
    ),
  ].sort();
  const availableSet = new Set(available);

  const explicitYear = questionHasExplicitCalendarYear(q);
  const mdKeys = extractMonthDayKeysFromQuestion(q);
  const hadDateIntentInQuestion = explicitYear || mdKeys.length > 0;

  const mergedFromScope = [
    ...new Set(
      scopeReportDates.map((d) => d.trim()).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    ),
  ];
  const inferredExplicit = inferIsoDatesFromChineseQuestion(q);

  if (!explicitYear && mdKeys.length > 0) {
    const resolved = [...new Set(available.filter((iso) => mdKeys.includes(iso.slice(5))))].sort();
    return {
      report_dates: resolved,
      stalemateNoExtractDate: hadDateIntentInQuestion && resolved.length === 0,
    };
  }

  const candidates = [...new Set([...mergedFromScope, ...inferredExplicit])];
  const filtered = candidates.filter((d) => availableSet.has(d)).sort();
  const hadAnyCandidate = candidates.length > 0;
  /** 问句/模型给出了具体日期候选，但本机「提取日期」均对不上 → 不得当作「未指定日期」回退为全量。 */
  const stalemateNoExtractDate =
    (hadDateIntentInQuestion && filtered.length === 0) || (hadAnyCandidate && filtered.length === 0);
  return {
    report_dates: filtered,
    stalemateNoExtractDate,
  };
}

/**
 * 仅从问句中提取**带明确年份**的 ISO 日期（`YYYY年M月D日`、`YYYY-MM-DD`）。
 * 「M月D日」无年份时不返回任何项，由 `resolveReportDatesAgainstVisibleHistory` 按本机历史解析。
 */
export function inferIsoDatesFromChineseQuestion(question: string): string[] {
  const out: string[] = [];
  const q = question.trim();
  const full = q.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (full) {
    out.push(`${full[1]}-${pad2(full[2])}-${pad2(full[3])}`);
  }
  const iso = q.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) out.push(`${iso[1]}-${iso[2]}-${iso[3]}`);
  return [...new Set(out.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))];
}
