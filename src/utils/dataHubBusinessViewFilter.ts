/**
 * @fileoverview 数据中台「数据列表 → 业务数据」表格的关键字筛选逻辑及 localStorage 持久化，
 * 供「报告管理 · 日报列表」与 DataSync 共用，使日报列表与当前 VIEW 可见行一致。
 *
 * @module utils/dataHubBusinessViewFilter
 */

const PREFIX = "qifeng_data_hub_business_filter_";

/** 同页 DataSync 写入筛选后通知日报列表重算 */
export const DATA_HUB_BUSINESS_FILTER_CHANGED_EVENT = "smart_tasks_data_hub_business_filter_changed";

export interface DataHubBusinessViewFilter {
  query: string;
  scope: "all" | string;
}

/**
 * 与 DataSync 中「关键字 / 查询范围」一致：按列名或单元格子串筛选。
 *
 * @param rows 扁平行
 * @param query 关键字（空则不过滤）
 * @param scopeCol `all` 或列名
 */
export function filterDataHubBusinessRows(
  rows: Record<string, string>[],
  query: string,
  scopeCol: "all" | string,
): Record<string, string>[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => {
    if (scopeCol === "all") {
      return Object.entries(row).some(
        ([key, val]) => key.toLowerCase().includes(q) || String(val).toLowerCase().includes(q),
      );
    }
    const cell = String(row[scopeCol] ?? "");
    return cell.toLowerCase().includes(q);
  });
}

/**
 * 持久化某接口下业务 VIEW 的筛选条件。
 *
 * @param profileId 接口 id
 * @param query 关键字
 * @param scope 查询范围
 */
export function saveDataHubBusinessViewFilter(
  profileId: string,
  query: string,
  scope: "all" | string,
): void {
  try {
    const payload: DataHubBusinessViewFilter = { query, scope };
    localStorage.setItem(PREFIX + profileId, JSON.stringify(payload));
  } catch {
    /* quota */
  }
  try {
    window.dispatchEvent(
      new CustomEvent(DATA_HUB_BUSINESS_FILTER_CHANGED_EVENT, { detail: { profileId } }),
    );
  } catch {
    /* ignore */
  }
}

/**
 * 读取某接口下已保存的业务 VIEW 筛选条件。
 *
 * @param profileId 接口 id
 */
export function loadDataHubBusinessViewFilter(profileId: string): DataHubBusinessViewFilter | null {
  try {
    const raw = localStorage.getItem(PREFIX + profileId)?.trim();
    if (!raw) return null;
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return null;
    const query = typeof (o as { query?: unknown }).query === "string" ? (o as { query: string }).query : "";
    const scopeRaw = (o as { scope?: unknown }).scope;
    const scope: "all" | string =
      scopeRaw === "all" || typeof scopeRaw === "string" ? (scopeRaw as "all" | string) : "all";
    return { query, scope };
  } catch {
    return null;
  }
}
