/**
 * @fileoverview 将「物料编码 + 物料描述」解析为结构化属性，并生成底表彩色标签列表。
 *
 * @module parseMaterialCode
 */

export type ParsedMaterialAttributes = {
  model: string;
  name: string;
  spec: string;
  grammage: string;
};

export type ParsedMaterial = {
  material_id: string;
  display_label: string;
  parsed_attributes: ParsedMaterialAttributes;
};

export type MaterialTagKind = "id" | "model" | "name" | "spec" | "grammage" | "source";

export type MaterialTag = { kind: MaterialTagKind; text: string };

/** 销售分析底表表头图例（不含 CSV 原文标签类型）。 */
export const MATERIAL_TAG_LEGEND: readonly { kind: MaterialTagKind; caption: string }[] = [
  { kind: "id", caption: "物料编码" },
  { kind: "model", caption: "型号" },
  { kind: "name", caption: "品名" },
  { kind: "spec", caption: "规格" },
  { kind: "grammage", caption: "克重" },
];

/**
 * 从「物料合并」单元格与独立编码/描述列推断 code、description。
 * - 若有物料描述列，description 优先取列值，code 取编码列或从合并列解析。
 * - 合并列为「数字编码 + 空白 + 描述」时拆分。
 * - 合并列本身为描述形态（含 - 与 /）时整段作为 description。
 */
export function resolveMaterialCodeAndDescription(
  mergedCell: string,
  explicitCode: string,
  explicitDesc: string,
): { code: string; description: string } {
  const merged = (mergedCell || "").trim();
  const code = (explicitCode || "").trim();
  const descCol = (explicitDesc || "").trim();

  if (descCol) {
    return { code: code || extractLeadingCodeFromMerged(merged), description: descCol };
  }

  const split = merged.match(/^([\d.]+)\s+(.+)$/);
  if (split) {
    return { code: split[1]!.trim(), description: split[2]!.trim() };
  }

  if (merged.includes("-") && merged.includes("/")) {
    return { code: code || "", description: merged };
  }

  if (/^[\d.]+$/.test(merged)) {
    return { code: merged, description: "" };
  }

  return { code: code || "", description: merged };
}

function extractLeadingCodeFromMerged(merged: string): string {
  const m = merged.trim().match(/^([\d.]+)/);
  return m ? m[1]! : "";
}

/**
 * 将物料描述解析为结构化 JSON；不符合常见形态时返回部分字段或仅含 id/display，不抛错。
 *
 * - Model: 描述开头至第一个 `-`
 * - Name: `-` 之后、第一个数字前片段中的**中文字符**
 * - Spec: `/` 前连续数字（去空格后）
 * - Grammage: `/` 后连续数字
 */
export function parseMaterialCode(code: string, description: string): ParsedMaterial | null {
  const id = (code || "").trim();
  const desc = (description || "").trim();
  const display = desc || id;
  if (!display && !id) return null;

  const attrs: ParsedMaterialAttributes = { model: "", name: "", spec: "", grammage: "" };

  if (!desc) {
    return { material_id: id, display_label: display, parsed_attributes: { ...attrs } };
  }

  const dashIdx = desc.indexOf("-");
  if (dashIdx >= 0) {
    attrs.model = desc.slice(0, dashIdx).trim();
    const afterDash = desc.slice(dashIdx + 1);
    const firstDig = afterDash.search(/\d/);
    const beforeNums = firstDig < 0 ? afterDash : afterDash.slice(0, firstDig);
    const chineseRuns = beforeNums.match(/[\u4e00-\u9fff]+/g);
    attrs.name = chineseRuns ? chineseRuns.join("") : beforeNums.trim().replace(/\s+/g, "");

    const tail = firstDig >= 0 ? afterDash.slice(firstDig) : "";
    fillSpecGrammage(attrs, tail);
  } else {
    fillSpecGrammage(attrs, desc);
  }

  return {
    material_id: id,
    display_label: desc,
    parsed_attributes: attrs,
  };
}

function fillSpecGrammage(attrs: ParsedMaterialAttributes, fragment: string) {
  const normalized = fragment.replace(/\s+/g, "");
  const slashIdx = normalized.indexOf("/");
  if (slashIdx >= 0) {
    const left = normalized.slice(0, slashIdx);
    const right = normalized.slice(slashIdx + 1);
    attrs.spec = matchFirstNumber(left);
    attrs.grammage = matchFirstNumber(right);
  } else {
    attrs.spec = matchFirstNumber(normalized);
  }
}

function matchFirstNumber(s: string): string {
  const m = s.match(/\d+(?:\.\d+)?/);
  return m ? m[0]! : "";
}

/** 由解析结果生成底表展示用标签；解析为空时退回源 CSV 物料标签文案。 */
export function materialParsedToTags(parsed: ParsedMaterial | null, fallbackSourceLabel: string): MaterialTag[] {
  const tags: MaterialTag[] = [];
  if (!parsed) {
    const fb = (fallbackSourceLabel || "").trim();
    if (fb) tags.push({ kind: "source", text: fb });
    return tags;
  }

  const { material_id: mid, parsed_attributes: a } = parsed;
  if (mid) tags.push({ kind: "id", text: mid });
  if (a.model) tags.push({ kind: "model", text: a.model });
  if (a.name) tags.push({ kind: "name", text: a.name });
  if (a.spec) tags.push({ kind: "spec", text: a.spec });
  if (a.grammage) tags.push({ kind: "grammage", text: a.grammage });

  const fb = (fallbackSourceLabel || "").trim();
  if (tags.length === 0 && fb) tags.push({ kind: "source", text: fb });
  return tags;
}
