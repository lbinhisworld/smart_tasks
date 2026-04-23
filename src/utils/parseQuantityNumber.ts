/**
 * @fileoverview 解析业务表「数量」单元格：**逗号 `,` 仅作千分位，点 `.` 仅作小数点**；绝不把点当成千分位。
 *
 * - **同时含逗号与点**：去掉全部逗号后，剩余为带小数点的数字（美式 `1,234.56`）。
 * - **仅逗号**：去掉全部逗号（`1,234,567` → `1234567`）。**不支持**逗号作小数点。
 * - **仅点**：整串按小数解析（`7.967`、`14.920`）。若出现**多个**点则无法解析（`null`），因点不能当千分位拼整数。
 *
 * @module parseQuantityNumber
 */

function countChar(s: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === ch) n++;
  return n;
}

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

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  let normalized: string;
  if (hasComma && hasDot) {
    normalized = s.replace(/,/g, "");
  } else if (hasComma) {
    normalized = s.replace(/,/g, "");
  } else if (hasDot) {
    normalized = s;
  } else {
    normalized = s;
  }

  if (countChar(normalized, ".") > 1) return null;

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
