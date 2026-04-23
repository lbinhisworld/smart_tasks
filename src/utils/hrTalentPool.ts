/**
 * @fileoverview 人事看板：自动匹配「齐峰协同办公平台」下「人才库」接口、拉取/解析 JSON。
 *
 * @module utils/hrTalentPool
 */

import type { DataPlatform, ExternalApiProfile } from "../types/externalApiProfile";
import { runDataHubInterfaceTestFetch } from "./dataHubInterfaceTestFetch";
import { extractBusinessRowsFromJson } from "./extractBusinessRowsFromJson";

/**
 * 在数据中台配置中定位「齐峰协同」平台下名称含「人才库」的接口（优先名称含「获取人才库」）。
 * @param platforms 平台列表
 * @param profiles 接口列表
 */
export function findTalentPoolProfile(
  platforms: DataPlatform[],
  profiles: ExternalApiProfile[],
): ExternalApiProfile | null {
  const qifeng = platforms.find((p) => /齐峰/.test(p.name) && (/协同/.test(p.name) || /办公/.test(p.name)));
  const candidates = qifeng
    ? profiles.filter((pr) => pr.platformId === qifeng.id)
    : profiles.filter((pr) => {
        const pl = platforms.find((x) => x.id === pr.platformId);
        return pl && /齐峰/.test(pl.name);
      });
  const byName = (needle: RegExp) => candidates.find((p) => needle.test(p.name));
  return byName(/获取人才库/) ?? byName(/人才库/) ?? null;
}

/**
 * 与数据中台「发送测试请求」一致：请求接口并写入会话缓存（见 {@link runDataHubInterfaceTestFetch}）。
 *
 * @param profile 接口配置
 */
export async function fetchTalentPoolRaw(profile: ExternalApiProfile): Promise<{
  ok: boolean;
  body: string;
  error?: string;
  httpStatus?: number;
}> {
  return runDataHubInterfaceTestFetch(profile);
}

/**
 * 解析缓存或拉取到的 JSON 正文为业务行。
 * @param rawBody 响应字符串
 */
export function parseTalentPoolRows(rawBody: string): {
  rows: Record<string, string>[];
  columns: string[];
  parseError?: string;
} {
  const t = rawBody.trim();
  if (!t) return { rows: [], columns: [], parseError: "空响应" };
  try {
    const json = JSON.parse(t) as unknown;
    return extractBusinessRowsFromJson(json);
  } catch {
    return { rows: [], columns: [], parseError: "JSON 解析失败" };
  }
}

/**
 * 在列名中按关键词找第一列（用于状态、职位、日期等）。
 * @param columns 列名列表
 * @param patterns 依次尝试的正则；命中列名即返回
 */
export function resolveColumnByHints(columns: string[], patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const hit = columns.find((c) => re.test(c));
    if (hit) return hit;
  }
  return null;
}

/** 常见列名：状态 */
export const COL_STATUS_HINTS = [/状态/, /招聘状态/, /流程状态/];
/** 常见列名：期望职位 / 岗位 */
export const COL_POSITION_HINTS = [/期望职位/, /应聘职位/, /岗位/, /职位(?!.*部门)/];
/** 常见列名：姓名 */
export const COL_NAME_HINTS = [/姓名/, /候选人/];
/** 常见列名：性别 */
export const COL_GENDER_HINTS = [/性别/];
/** 常见列名：推荐等级 */
export const COL_LEVEL_HINTS = [/推荐等级/, /等级(?!.*岗位)/, /星级/];
/** 常见列名：期望薪资 */
export const COL_SALARY_HINTS = [/期望薪资/, /期望工资/, /期望薪酬/, /月薪/, /薪[资酬]/, /待遇(?!.*假)/, /salary/i];
/** 常见列名：邮箱 */
export const COL_EMAIL_HINTS = [/邮箱/, /e-?mail/i, /邮件地址/, /电子邮箱/];
/** 常见列名：电话 */
export const COL_PHONE_HINTS = [/手机/, /电话/, /联系电话/, /手机号/, /联系方式/];
/** 常见列名：推荐理由 */
export const COL_REASON_HINTS = [/推荐理由/, /推荐原因/, /推荐说明/];
/** 人才池「创建时间」列（接口字段常为 `createDate`） */
export const COL_TALENT_CREATE_DATE_HINTS = [/^createDate$/i, /^create_time$/i, /创建时间/, /创建日期/];

/**
 * 将人才池「创建时间」单元格格式化为 `yyyy-MM-dd HH:mm:ss`（本地时区）。
 * 支持毫秒/秒级 Unix 时间戳数字串；已为可解析日期字符串时亦尝试格式化。
 *
 * @param raw 单元格原文
 */
export function formatTalentCreateDateDisplay(raw: string): string {
  const s = raw.trim();
  if (!s) return "—";

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const toDisplay = (ms: number) => {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return s;
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  };

  if (/^\d{13}$/.test(s)) return toDisplay(Number(s));
  if (/^\d{10}$/.test(s)) return toDisplay(Number(s) * 1000);

  const n = Number(s);
  if (Number.isFinite(n) && /^\d+\.?\d*$/.test(s)) {
    if (n >= 1e12 && n < 1e15) return toDisplay(n);
    if (n >= 1e9 && n < 1e12) return toDisplay(n * 1000);
  }

  const parsed = Date.parse(s.replace(/\//g, "-"));
  if (!Number.isNaN(parsed)) return toDisplay(parsed);

  return s;
}

/** 常见列名：日期类（用于接口内趋势） */
export const COL_DATE_HINTS = [
  /登记时间/,
  /创建时间/,
  /更新时间/,
  /入库时间/,
  /投递时间/,
  /申请时间/,
  /参加工作时间/,
  /日期(?!.*截止)/,
  /时间$/,
];

/**
 * 将单元格中的日期规范为 `YYYY-MM-DD`；无法识别则返回 `null`。
 * @param raw 单元格原文
 */
export function normalizeCellToIsoDay(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    const y = m[1];
    const mo = String(Number(m[2])).padStart(2, "0");
    const d = String(Number(m[3])).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  const iso = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return null;
}

/**
 * 按自然日聚合人数（接口返回中含日期列时）。
 * @param rows 业务行
 * @param dateCol 日期列名
 */
export function aggregateTotalByDay(
  rows: Record<string, string>[],
  dateCol: string,
): { day: string; count: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const day = normalizeCellToIsoDay(String(r[dateCol] ?? ""));
    if (!day) continue;
    map.set(day, (map.get(day) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-60);
}

/**
 * 按自然日 + 期望职位聚合 Top N 岗位曲线数据。
 * @param rows 业务行
 * @param dateCol 日期列
 * @param positionCol 职位列
 * @param topN 每日保留的岗位种类数（按全局频次取 Top）
 */
export function aggregatePositionTrendByDay(
  rows: Record<string, string>[],
  dateCol: string,
  positionCol: string,
  topN: number,
): { days: string[]; series: { name: string; values: number[] }[] } {
  const freq = new Map<string, number>();
  for (const r of rows) {
    const p = String(r[positionCol] ?? "").trim() || "（未填）";
    freq.set(p, (freq.get(p) ?? 0) + 1);
  }
  const topNames = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([n]) => n);

  const daySet = new Set<string>();
  for (const r of rows) {
    const d = normalizeCellToIsoDay(String(r[dateCol] ?? ""));
    if (d) daySet.add(d);
  }
  const days = [...daySet].sort((a, b) => a.localeCompare(b)).slice(-60);

  const series = topNames.map((name) => ({
    name,
    values: days.map((day) => {
      let c = 0;
      for (const r of rows) {
        const rd = normalizeCellToIsoDay(String(r[dateCol] ?? ""));
        const rp = String(r[positionCol] ?? "").trim() || "（未填）";
        if (rd === day && rp === name) c += 1;
      }
      return c;
    }),
  }));
  return { days, series };
}

/** 岗位薪资堆叠图：月薪分档标签（由低到高，末档为未解析） */
export const SALARY_DISTRIBUTION_BANDS = ["<5千", "5千-8千", "8千-1.2万", "1.2万-2万", "≥2万", "面议/未填"] as const;

/**
 * 将月薪（元）映射到 {@link SALARY_DISTRIBUTION_BANDS} 下标。
 * @param yuan 月薪中位数（元）；`null` 表示未填或无法解析
 */
export function salaryBandIndex(yuan: number | null): number {
  if (yuan == null || !Number.isFinite(yuan)) return 5;
  if (yuan < 5000) return 0;
  if (yuan < 8000) return 1;
  if (yuan < 12000) return 2;
  if (yuan < 20000) return 3;
  return 4;
}

/**
 * 从单元格文本解析「月薪」区间的中点（元）；面议/空/无法识别返回 `null`。
 * @param raw 单元格原文（如 `8-12K`、`12-15万`、`8000-12000`）
 */
export function parseMonthlySalaryMidYuan(raw: string): number | null {
  const t = raw.replace(/\s/g, "").trim();
  if (!t || /面议|不限|保密|negotiable/i.test(t)) return null;

  const toNum = (s: string) => parseFloat(String(s).replace(/,/g, ""));

  let m = t.match(/(\d+(?:\.\d+)?)[万wW][-～~至](\d+(?:\.\d+)?)[万wW]/);
  if (m) {
    const mid = (toNum(m[1]) + toNum(m[2])) / 2;
    return mid * 10000;
  }

  m = t.match(/(\d+(?:\.\d+)?)\s*[-～~至]\s*(\d+(?:\.\d+)?)\s*([万wWkK千])?/);
  if (m) {
    const a = toNum(m[1]);
    const b = toNum(m[2]);
    const u = (m[3] ?? "").toLowerCase();
    const mid = (a + b) / 2;
    if (/万|w/.test(u)) return mid * 10000;
    if (/k|千/.test(u)) return mid * 1000;
    if (u === "元") return mid;
    if (a >= 300 && b >= 300) return mid;
    if (mid > 0 && mid <= 100) return mid * 1000;
    return mid;
  }

  m = t.match(/(\d+(?:\.\d+)?)\s*[万wW](?![-～~至])/);
  if (m) return toNum(m[1]) * 10000;

  m = t.match(/(\d+(?:\.\d+)?)\s*[kK千](?![-～~至])/);
  if (m) return toNum(m[1]) * 1000;

  m = t.match(/(\d{4,7})/);
  if (m) return toNum(m[1]);

  return null;
}

/**
 * 按「岗位 × 薪资档」聚合，用于堆叠条展示各岗位薪资结构。
 * @param rows 业务行
 * @param positionCol 岗位列名
 * @param salaryCol 薪资列名
 * @param topPositions 取出现频次最高的前若干种岗位
 */
export function buildPositionSalaryBandSeries(
  rows: Record<string, string>[],
  positionCol: string | null,
  salaryCol: string | null,
  topPositions: number,
): { position: string; bandCounts: number[]; nRows: number; nParsed: number }[] {
  if (!positionCol || !salaryCol || rows.length === 0) return [];

  const freq = new Map<string, number>();
  for (const r of rows) {
    const p = String(r[positionCol] ?? "").trim() || "（未填）";
    freq.set(p, (freq.get(p) ?? 0) + 1);
  }
  const topNames = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topPositions)
    .map(([n]) => n);

  return topNames.map((position) => {
    const bandCounts = [0, 0, 0, 0, 0, 0];
    let nParsed = 0;
    let nRows = 0;
    for (const r of rows) {
      const rp = String(r[positionCol] ?? "").trim() || "（未填）";
      if (rp !== position) continue;
      nRows += 1;
      const y = parseMonthlySalaryMidYuan(String(r[salaryCol] ?? ""));
      const idx = salaryBandIndex(y);
      if (y != null) nParsed += 1;
      bandCounts[idx] += 1;
    }
    return { position, bandCounts, nRows, nParsed };
  });
}
