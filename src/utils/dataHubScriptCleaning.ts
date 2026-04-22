/**
 * @fileoverview 数据中台「脚本清洗」：本地解析原始 JSON，按配置将列表行聚合为「分公司 + 日期 → 车间日报列表」结构，不经过大模型。
 *
 * @module dataHubScriptCleaning
 */

/** 当前唯一支持的脚本清洗类型 */
export type DataHubScriptCleaningKind = "groupBranchWorkshopDate";

/**
 * 分组脚本规格（与界面表单一一对应，存为 `ExternalApiProfile.jsonCleaningScriptSpec` 的 JSON 字符串）。
 */
export interface DataHubGroupByBranchWorkshopDateSpec {
  version: 1;
  kind: DataHubScriptCleaningKind;
  /**
   * 从根 JSON 到「行对象数组」的路径，点分键名，如 `data.list`。
   * 空字符串表示根节点自身即为数组。
   */
  listPath: string;
  /**
   * 数组每一项内到「扁平行对象」的路径，如 `variables`。
   * 空字符串表示列表元素本身即为行对象。
   */
  itemPath: string;
  /** 行对象上「分公司」字段名 */
  branchField: string;
  /** 行对象上「车间」字段名 */
  workshopField: string;
  /** 行对象上「日报日期」字段名 */
  dateField: string;
  /** 行对象上正文/详情字段名 */
  detailField: string;
}

/** 新建接口或缺省时的推荐脚本配置（典型数据中台 list + variables） */
export const DEFAULT_GROUP_SCRIPT_SPEC: DataHubGroupByBranchWorkshopDateSpec = {
  version: 1,
  kind: "groupBranchWorkshopDate",
  listPath: "data.list",
  itemPath: "variables",
  branchField: "所属分公司",
  workshopField: "所属车间",
  dateField: "日报日期",
  detailField: "日报内容",
};

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

/**
 * 按点分路径从 JSON 取值；路径为空时返回 `root`。
 * @param root 解析后的根
 * @param path 点分路径
 */
export function getJsonPath(root: unknown, path: string): unknown {
  const p = path.trim();
  if (!p) return root;
  let cur: unknown = root;
  for (const seg of p.split(".").filter(Boolean)) {
    if (!isRecord(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * 解析并校验已保存的脚本规格 JSON。
 * @param raw `jsonCleaningScriptSpec` 原文
 */
export function parseScriptCleaningSpec(raw: string | undefined | null): DataHubGroupByBranchWorkshopDateSpec | null {
  if (!raw?.trim()) return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (!isRecord(o)) return null;
    if (o.version !== 1) return null;
    if (o.kind !== "groupBranchWorkshopDate") return null;
    const listPath = typeof o.listPath === "string" ? o.listPath : "";
    const itemPath = typeof o.itemPath === "string" ? o.itemPath : "";
    const branchField = typeof o.branchField === "string" ? o.branchField.trim() : "";
    const workshopField = typeof o.workshopField === "string" ? o.workshopField.trim() : "";
    const dateField = typeof o.dateField === "string" ? o.dateField.trim() : "";
    const detailField = typeof o.detailField === "string" ? o.detailField.trim() : "";
    if (!branchField || !workshopField || !dateField || !detailField) return null;
    return {
      version: 1,
      kind: "groupBranchWorkshopDate",
      listPath,
      itemPath,
      branchField,
      workshopField,
      dateField,
      detailField,
    };
  } catch {
    return null;
  }
}

type WorkshopAgg = { 车间名称: string; 日报详情: string };
type GroupOut = { 分公司名称: string; 日报日期: string; 车间日报列表: WorkshopAgg[] };

/**
 * 按「分公司 + 日报日期」聚合，其下车间列表合并多行同车间正文。
 * @param rawJsonText 原始接口 JSON 文本
 * @param spec 分组配置
 */
export function runGroupBranchWorkshopDateCleaning(
  rawJsonText: string,
  spec: DataHubGroupByBranchWorkshopDateSpec,
): { ok: true; text: string } | { ok: false; error: string } {
  let root: unknown;
  try {
    root = JSON.parse(rawJsonText) as unknown;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `原始 JSON 无法解析：${msg}` };
  }

  const listRaw = getJsonPath(root, spec.listPath);
  if (!Array.isArray(listRaw)) {
    const hint = spec.listPath.trim() ? `「${spec.listPath.trim()}」` : "根节点";
    return { ok: false, error: `脚本清洗：列表路径 ${hint} 未解析到数组。` };
  }

  type Inner = { branch: string; date: string; byWorkshop: Map<string, string[]> };
  const groups = new Map<string, Inner>();

  for (const item of listRaw) {
    const rowObj = spec.itemPath.trim() ? getJsonPath(item, spec.itemPath.trim()) : item;
    if (!isRecord(rowObj)) continue;
    const branch = String(rowObj[spec.branchField] ?? "").trim();
    const workshop = String(rowObj[spec.workshopField] ?? "").trim();
    const date = String(rowObj[spec.dateField] ?? "").trim();
    const detail = String(rowObj[spec.detailField] ?? "").trim();
    if (!branch || !date) continue;
    const gk = `${branch}\u0000${date}`;
    let g = groups.get(gk);
    if (!g) {
      g = { branch, date, byWorkshop: new Map() };
      groups.set(gk, g);
    }
    const ws = workshop || "—";
    const parts = g.byWorkshop.get(ws) ?? [];
    parts.push(detail);
    g.byWorkshop.set(ws, parts);
  }

  const out: GroupOut[] = [];
  for (const g of groups.values()) {
    const 车间日报列表: WorkshopAgg[] = [...g.byWorkshop.entries()]
      .map(([车间名称, parts]) => ({
        车间名称,
        日报详情: parts.filter((p) => p.length > 0).join("\n\n"),
      }))
      .sort((a, b) => a.车间名称.localeCompare(b.车间名称, "zh-CN"));
    out.push({
      分公司名称: g.branch,
      日报日期: g.date,
      车间日报列表,
    });
  }

  out.sort((a, b) => {
    const c = a.分公司名称.localeCompare(b.分公司名称, "zh-CN");
    if (c !== 0) return c;
    return a.日报日期.localeCompare(b.日报日期, "zh-CN");
  });

  try {
    return { ok: true, text: JSON.stringify(out, null, 2) };
  } catch {
    return { ok: false, error: "脚本清洗：结果序列化失败。" };
  }
}
