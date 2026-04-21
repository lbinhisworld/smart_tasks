/**
 * @fileoverview 从销售数据预览表头/行映射为「销售分析底表」行（与业务字段对齐，物料标签由物料合并解析生成）。
 *
 * @module salesAnalysisBaseFromPreview
 */

import {
  materialParsedToTags,
  parseMaterialCode,
  resolveMaterialCodeAndDescription,
  type MaterialTag,
} from "./parseMaterialCode";
import { formatQuantityTwoDecimalsForBase } from "./parseQuantityNumber";

export type SalesAnalysisBaseRow = {
  date: string;
  customerName: string;
  salesGroup: string;
  salesperson: string;
  /** 由 parseMaterialCode + 物料合并等字段生成的彩色标签 */
  materialTags: MaterialTag[];
  materialMergedCode: string;
  quantity: string;
};

export type { MaterialTag };

const OUTPUT_LABELS: Record<Exclude<keyof SalesAnalysisBaseRow, "materialTags">, string> = {
  date: "日期",
  customerName: "客户名称",
  salesGroup: "销售组",
  salesperson: "业务员",
  materialMergedCode: "物料合并编码",
  quantity: "数量",
};

/** 底表列 → 销售预览中可能出现的表头名（按优先级） */
const SOURCE_NAMES: Record<Exclude<keyof SalesAnalysisBaseRow, "materialTags">, string[]> = {
  date: ["单据日期"],
  customerName: ["往来户名称"],
  salesGroup: ["销售组"],
  salesperson: ["业务员"],
  materialMergedCode: ["物料合并"],
  quantity: ["数量"],
};

const MATERIAL_CODE_SOURCES = ["存货编码", "物料编码", "物料编号", "产品编码", "存货代码"];
const MATERIAL_DESC_SOURCES = ["物料描述", "存货名称", "规格型号"];
const CSV_MATERIAL_LABEL_SOURCES = ["物料标签"];

/** 与底表映射一致，定位 CSV 预览中的「往来户名称」列（供保存预览时改写客户列） */
export function findSalesCustomerSourceColumnIndex(headers: string[]): number {
  return findColumnIndex(headers, SOURCE_NAMES.customerName);
}

function findColumnIndex(headers: string[], candidates: string[]): number {
  const trimmed = headers.map((h) => h.trim());
  for (const c of candidates) {
    const t = c.trim();
    const exact = trimmed.indexOf(t);
    if (exact >= 0) return exact;
  }
  for (const c of candidates) {
    const t = c.trim();
    const fuzzy = trimmed.findIndex((h) => h === t || h.includes(t) || t.includes(h));
    if (fuzzy >= 0) return fuzzy;
  }
  return -1;
}

function findFirstAmong(headers: string[], groups: string[]): number {
  for (const g of groups) {
    const i = findColumnIndex(headers, [g]);
    if (i >= 0) return i;
  }
  return -1;
}

export type SalesAnalysisBaseBuildResult = {
  rows: SalesAnalysisBaseRow[];
  /** 未能匹配到的底表列（展示名）；物料标签不依赖单独源列 */
  missingSourceLabels: string[];
};

/**
 * @param headers - 预览表头（已与数据行对齐）
 * @param rows - 预览数据行
 */
export function buildSalesAnalysisBaseFromPreview(
  headers: string[],
  rows: string[][],
): SalesAnalysisBaseBuildResult {
  type FixedKey = Exclude<keyof SalesAnalysisBaseRow, "materialTags">;
  const fixedKeys = Object.keys(SOURCE_NAMES) as FixedKey[];
  const indexByKey = {} as Record<FixedKey, number>;
  const missingSourceLabels: string[] = [];

  for (const key of fixedKeys) {
    const i = findColumnIndex(headers, SOURCE_NAMES[key]);
    indexByKey[key] = i;
    if (i < 0) {
      missingSourceLabels.push(`${OUTPUT_LABELS[key]}（缺源列：${SOURCE_NAMES[key].join(" / ")}）`);
    }
  }

  const idxMerge = indexByKey.materialMergedCode;
  const idxCodeExtra = findFirstAmong(headers, MATERIAL_CODE_SOURCES);
  const idxDescExtra = findFirstAmong(headers, MATERIAL_DESC_SOURCES);
  const idxCsvLabel = findColumnIndex(headers, CSV_MATERIAL_LABEL_SOURCES);

  const cellAt = (row: string[], i: number) => {
    if (i < 0 || i >= row.length) return "";
    return row[i] ?? "";
  };

  const out: SalesAnalysisBaseRow[] = rows.map((row) => {
    const cell = (key: FixedKey) => cellAt(row, indexByKey[key]);

    const mergedRaw = idxMerge >= 0 ? cellAt(row, idxMerge) : "";
    const exCode = cellAt(row, idxCodeExtra);
    const exDesc = cellAt(row, idxDescExtra);
    const { code, description } = resolveMaterialCodeAndDescription(mergedRaw, exCode, exDesc);
    const parsed = parseMaterialCode(code, description);
    const csvLabel = idxCsvLabel >= 0 ? cellAt(row, idxCsvLabel) : "";
    const materialTags = materialParsedToTags(parsed, csvLabel);

    return {
      date: cell("date"),
      customerName: cell("customerName"),
      salesGroup: cell("salesGroup"),
      salesperson: cell("salesperson"),
      materialTags,
      materialMergedCode: cell("materialMergedCode"),
      quantity: formatQuantityTwoDecimalsForBase(cell("quantity")),
    };
  });

  return { rows: out, missingSourceLabels };
}

export const SALES_ANALYSIS_BASE_HEADERS: readonly string[] = [
  "日期",
  "客户名称",
  "销售组",
  "业务员",
  "物料标签",
  "物料合并编码",
  "数量",
] as const;
