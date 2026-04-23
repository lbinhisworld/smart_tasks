/**
 * @fileoverview 报告管理「日报列表」：从会话中原始接口响应（`loadDataSyncLastBody`）解析行；
 * 与数据中台「数据列表 → 业务数据」一致：先 `extractBusinessRowsFromJson`，再应用已持久化的 VIEW 关键字筛选（见 `dataHubBusinessViewFilter`）。
 *
 * @module reportDailyListFromDataHub
 */

import { extractBusinessRowsFromJson } from "./extractBusinessRowsFromJson";
import { extractDateFromPlainText } from "./extractDateFromText";
import {
  filterDataHubBusinessRows,
  loadDataHubBusinessViewFilter,
} from "./dataHubBusinessViewFilter";

/** 本地日历日 `YYYY-MM-DD`（用于日期控件默认值） */
export function localIsoDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 将单元格中的日报日期规范为 `YYYY-MM-DD`，便于与日期筛选比较。
 * @param reportDateCell 接口中的「日报日期」等原文
 */
export function normalizeReportDateCellToIso(reportDateCell: string): string | null {
  const t = reportDateCell.trim();
  if (!t) return null;
  const iso = extractDateFromPlainText(t);
  if (iso) return iso;
  const m = t.match(/\b(20\d{2})[/-](\d{1,2})[/-](\d{1,2})\b/);
  if (m) {
    const y = +m[1]!;
    const mo = String(+m[2]!).padStart(2, "0");
    const da = String(+m[3]!).padStart(2, "0");
    return `${y}-${mo}-${da}`;
  }
  return null;
}

/** localStorage：用户选择的日报列表数据源接口 id */
export const REPORT_DAILY_LIST_PROFILE_STORAGE_KEY = "smart_tasks_report_daily_list_profile_id";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 从行对象中取首个非空单元格（按候选列名顺序）。
 * @param row 业务扁平行
 * @param keys 候选列名（精确匹配 JSON 展开后的键）
 */
export function pickFirstCell(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v === undefined) continue;
    const t = String(v).trim();
    if (t.length > 0) return t;
  }
  return "";
}

/**
 * 尝试将常见日期时间字符串解析为毫秒时间戳，失败返回 `0`。
 * @param raw 单元格原文
 */
export function parseFlexibleDateTimeMs(raw: string): number {
  const s = raw.trim();
  if (!s) return 0;
  const ms = Date.parse(s.replace(/-/g, "/"));
  if (!Number.isNaN(ms)) return ms;
  return 0;
}

/**
 * 从扁平行推断「创建时间」用于排序（降序）；无则回退 `提交时间`。
 * @param row 业务扁平行
 */
export function inferCreatedSortMs(row: Record<string, string>): number {
  const createdKeys = [
    "创建时间",
    "创建日期",
    "createTime",
    "createdTime",
    "createdAt",
    "gmtCreate",
    "ctime",
    "insertTime",
  ];
  for (const k of createdKeys) {
    const v = row[k]?.trim();
    if (v) {
      const ms = parseFlexibleDateTimeMs(v);
      if (ms > 0) return ms;
    }
  }
  const submit = pickFirstCell(row, ["提交时间", "submitTime", "提交日期时间"]);
  const ms2 = parseFlexibleDateTimeMs(submit);
  return ms2 > 0 ? ms2 : 0;
}

/** 日报列表一行的展示字段（与数据中台 variables 对齐） */
export interface DailyReportListDisplayRow {
  /** 数据中台「所属分公司」，界面展示为「分公司/职能部门」 */
  parentCompany: string;
  /** 部门/车间 */
  deptWorkshop: string;
  /** 提交人 */
  submitter: string;
  /** 日报日期（原文） */
  reportDate: string;
  /** 日报详情全文（如「日报内容」） */
  reportDetail: string;
  /** 提交时间 */
  submitTime: string;
  /** 排序用：创建时间毫秒，无则 0 */
  sortMs: number;
}

/**
 * 将 `extractBusinessRowsFromJson` 的一行映射为日报列表展示行。
 * @param row 扁平行
 */
export function mapRowToDailyDisplay(row: Record<string, string>): DailyReportListDisplayRow {
  const parentCompany = pickFirstCell(row, ["所属分公司"]);
  const deptWorkshop = pickFirstCell(row, ["部门/车间", "部门", "车间", "所属车间", "所属部门"]);
  const submitter = pickFirstCell(row, ["提交人", "填报人", "录入人"]);
  const reportDate = pickFirstCell(row, ["日报日期", "报告日期", "日期"]);
  const reportDetail = pickFirstCell(row, ["日报内容", "日报正文", "content", "正文"]);
  const submitTime = pickFirstCell(row, ["提交时间", "submitTime", "提交日期时间", "上报时间"]);
  return {
    parentCompany,
    deptWorkshop,
    submitter,
    reportDate,
    reportDetail,
    submitTime,
    sortMs: inferCreatedSortMs(row),
  };
}

/**
 * 读取用户上次选择的接口 profile id。
 */
export function readPreferredDailyListProfileId(): string | null {
  try {
    const v = localStorage.getItem(REPORT_DAILY_LIST_PROFILE_STORAGE_KEY)?.trim();
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * 持久化日报列表数据源接口 id。
 * @param id 接口配置 id；空串则清除
 */
export function writePreferredDailyListProfileId(id: string | null): void {
  try {
    if (!id || !id.trim()) localStorage.removeItem(REPORT_DAILY_LIST_PROFILE_STORAGE_KEY);
    else localStorage.setItem(REPORT_DAILY_LIST_PROFILE_STORAGE_KEY, id.trim());
  } catch {
    /* quota / private mode */
  }
}

/**
 * 从会话缓存中的响应 JSON 解析业务行并映射为日报列表行（未排序）。
 * @param body `loadDataSyncLastBody` 返回的原始响应字符串
 */
export function parseDailyRowsFromHubResponseBody(body: string): DailyReportListDisplayRow[] {
  const raw = body.trim();
  if (!raw) return [];
  let root: unknown;
  try {
    root = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  const { rows } = extractBusinessRowsFromJson(root);
  return rows.map((r) => mapRowToDailyDisplay(r));
}

/**
 * 按创建时间降序排列（大在前）；`sortMs` 相同则按提交时间、日报日期字符串稳定次序。
 * @param rows 展示行
 */
export function sortDailyRowsByCreatedDesc(rows: DailyReportListDisplayRow[]): DailyReportListDisplayRow[] {
  return [...rows].sort((a, b) => {
    if (b.sortMs !== a.sortMs) return b.sortMs - a.sortMs;
    const st = b.submitTime.localeCompare(a.submitTime, "zh-CN");
    if (st !== 0) return st;
    return b.reportDate.localeCompare(a.reportDate, "zh-CN");
  });
}

/**
 * 与数据中台「数据列表 → 业务数据」VIEW 一致：解析原始 JSON → 扁平行 → 应用已保存的关键字筛选 → 映射为日报列表行并排序。
 *
 * @param profileId 当前接口 id（用于读取 VIEW 筛选）；空则不做关键字筛选
 * @param body 原始响应正文
 */
export function parseDailyRowsForReportList(
  profileId: string | null,
  body: string,
): DailyReportListDisplayRow[] {
  const raw = body.trim();
  if (!raw) return [];
  let root: unknown;
  try {
    root = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  let { rows } = extractBusinessRowsFromJson(root);
  if (profileId) {
    const f = loadDataHubBusinessViewFilter(profileId);
    if (f) {
      rows = filterDataHubBusinessRows(rows, f.query, f.scope);
    }
  }
  const mapped = rows.map((r) => mapRowToDailyDisplay(r));
  return sortDailyRowsByCreatedDesc(mapped);
}

/** 日报列表筛选条件 */
export interface DailyReportListFilters {
  /** 分公司/职能部门（对应数据中台「所属分公司」单元格，下拉选值） */
  branchFunctional: string;
  /** 部门/车间（下拉选值） */
  deptWorkshop: string;
  submitter: string;
  /** `YYYY-MM-DD`，空表示不按日期筛；日报列表初始为空以展示全部 */
  reportDateIso: string;
}

/**
 * 筛选：分公司/职能部门、部门/车间、日报日期为精确匹配；**提交人**为子串模糊匹配（不区分大小写）。
 * @param rows 已排序或可未排序
 * @param f 筛选条件
 */
export function filterDailyRowsExact(rows: DailyReportListDisplayRow[], f: DailyReportListFilters): DailyReportListDisplayRow[] {
  const bf = f.branchFunctional.trim();
  const dw = f.deptWorkshop.trim();
  const su = f.submitter.trim();
  const rdIso = f.reportDateIso.trim();
  return rows.filter((r) => {
    if (bf && r.parentCompany.trim() !== bf) return false;
    if (dw && r.deptWorkshop.trim() !== dw) return false;
    if (su) {
      const cell = r.submitter.trim().toLowerCase();
      const q = su.toLowerCase();
      if (!cell.includes(q)) return false;
    }
    if (rdIso) {
      const rowIso = normalizeReportDateCellToIso(r.reportDate);
      if (!rowIso || rowIso !== rdIso) return false;
    }
    return true;
  });
}

/**
 * 从根 JSON 猜测是否为数据中台 `data.list` 形态（用于空数据时的友好提示）。
 * @param body 原始响应字符串
 */
export function looksLikeHubListJson(body: string): boolean {
  const raw = body.trim();
  if (!raw) return false;
  let root: unknown;
  try {
    root = JSON.parse(raw) as unknown;
  } catch {
    return false;
  }
  if (!isRecord(root)) return false;
  const data = root["data"];
  if (!isRecord(data)) return false;
  return Array.isArray(data["list"]);
}
