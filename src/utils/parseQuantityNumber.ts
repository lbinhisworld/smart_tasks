/**
 * @fileoverview 解析业务表「数量」单元格：兼容美式/欧式小数与点或逗号千分位（如 7.967 → 7967）。
 *
 * @module parseQuantityNumber
 */

/**
 * 将数量字符串解析为数字（保留符号）。无法解析时返回 null。
 */
export function parseQuantityNumberString(raw: string): number | null {
  let s = raw.replace(/\s+/g, "").trim();
  if (!s) return null;

  let neg = false;
  if (s.startsWith("-")) {
    neg = true;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }
  if (!s) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      normalized = s.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = s.replace(/,/g, "");
    }
  } else if (lastDot >= 0) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      normalized = s.replace(/\./g, "");
    } else {
      normalized = s;
    }
  } else if (lastComma >= 0) {
    if (/^\d{1,3}(,\d{3})+$/.test(s)) {
      normalized = s.replace(/,/g, "");
    } else {
      normalized = s.replace(",", ".");
    }
  } else {
    normalized = s;
  }

  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/**
 * 与分档统计一致：仅保留严格为正、可解析的数量。
 */
export function parsePositiveQuantityFromCell(raw: unknown): number | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return raw;
  }
  if (typeof raw !== "string") return null;
  const n = parseQuantityNumberString(raw);
  if (n === null || n <= 0) return null;
  return n;
}

/** 拆解写入底表时：可解析则固定两位小数，否则保留原文本（去首尾空白）。 */
export function formatQuantityTwoDecimalsForBase(raw: string): string {
  const n = parseQuantityNumberString(raw);
  if (n === null || !Number.isFinite(n)) return raw.trim();
  return n.toFixed(2);
}
