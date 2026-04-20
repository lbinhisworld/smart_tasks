/**
 * @fileoverview 从典型开放接口 JSON（如 `data.list` + `variables`）中抽取表格行与列顺序。
 *
 * @module utils/extractBusinessRowsFromJson
 */

/**
 * 将任意值转为表格单元格展示字符串。
 * @param v 任意 JSON 值
 */
function toCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * 尝试从根节点解析出「数据行」数组引用。
 * @param node 任意 JSON 根
 */
function extractListArray(node: unknown): unknown[] | null {
  if (node === null || node === undefined) return null;
  if (Array.isArray(node)) return node;
  if (typeof node !== "object") return null;
  const o = node as Record<string, unknown>;
  if (Array.isArray(o.list)) return o.list;
  if (o.data !== undefined && typeof o.data === "object" && o.data !== null) {
    const d = o.data as Record<string, unknown>;
    if (Array.isArray(d.list)) return d.list;
    if (Array.isArray(d.records)) return d.records;
    if (Array.isArray(d.rows)) return d.rows;
  }
  if (Array.isArray(o.records)) return o.records;
  if (Array.isArray(o.rows)) return o.rows;
  return null;
}

/**
 * 从接口 JSON 中抽取扁平行与列顺序（优先展开 `variables`、`prettyValue`）。
 * @param json `JSON.parse` 后的根对象
 */
export function extractBusinessRowsFromJson(json: unknown): {
  rows: Record<string, string>[];
  columns: string[];
} {
  const list = extractListArray(json);
  if (!list || list.length === 0) return { rows: [], columns: [] };

  const rows: Record<string, string>[] = [];
  const columnOrder: string[] = [];
  const seen = new Set<string>();

  const addCol = (k: string) => {
    if (!seen.has(k)) {
      seen.add(k);
      columnOrder.push(k);
    }
  };

  for (const item of list) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const row: Record<string, string> = {};

    for (const [k, v] of Object.entries(obj)) {
      if (k === "variables" && v !== null && typeof v === "object" && !Array.isArray(v)) {
        for (const [vk, vv] of Object.entries(v as Record<string, unknown>)) {
          row[vk] = toCell(vv);
          addCol(vk);
        }
      } else if (k === "prettyValue" && v !== null && typeof v === "object" && !Array.isArray(v)) {
        for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
          const key = `展示·${pk}`;
          row[key] = toCell(pv);
          addCol(key);
        }
      } else {
        row[k] = toCell(v);
        addCol(k);
      }
    }
    rows.push(row);
  }

  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        columnOrder.push(k);
      }
    }
  }

  return { rows, columns: columnOrder };
}
