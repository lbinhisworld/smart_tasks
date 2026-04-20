/**
 * @fileoverview 日报系统中台同步 JSON：`data.list[].variables` → 扁平行，供表格与按分公司解析。
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readField(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t.length ? t : null;
  }
  const s = String(v).trim();
  return s.length ? s : null;
}

/** 标准提取行（与约定字段名一致） */
export interface HubDailyStandardRow {
  date: string | null;
  company_name: string | null;
  content: string | null;
}

export interface TryParseDataHubDailyListResult {
  /** 是否为含 `data.list` 数组的中台结构（即使 list 为空） */
  isHubShape: boolean;
  rows: HubDailyStandardRow[];
}

/**
 * 从日报正文字符串解析中台 JSON：遍历 `data.list`，读取每条 `variables` 下
 * `日报日期` / `所属分公司` / `日报内容`。
 * - 缺 `variables` 的条目跳过；
 * - 字段缺失则为 `null`；
 * - 三个字段均为空的条目跳过。
 */
export function tryParseDataHubDailyListJson(text: string): TryParseDataHubDailyListResult {
  let root: unknown;
  try {
    root = JSON.parse(text.trim());
  } catch {
    return { isHubShape: false, rows: [] };
  }

  if (!isRecord(root)) return { isHubShape: false, rows: [] };

  const data = root["data"];
  if (!isRecord(data)) return { isHubShape: false, rows: [] };

  const list = data["list"];
  if (!Array.isArray(list)) return { isHubShape: false, rows: [] };

  const rows: HubDailyStandardRow[] = [];

  for (const item of list) {
    if (!isRecord(item)) continue;
    const variables = item["variables"];
    if (!isRecord(variables)) continue;

    const date = readField(variables["日报日期"]);
    const company_name = readField(variables["所属分公司"]);
    const content = readField(variables["日报内容"]);

    if (!date && !company_name && !content) continue;

    rows.push({ date, company_name, content });
  }

  return { isHubShape: true, rows };
}
