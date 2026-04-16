/**
 * 从日报正文中尝试解析「报告日期」。
 * 命中多个时取文中**首次**出现的合法日期（从左到右阅读顺序）。
 */

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isValidCalendarDate(y: number, m: number, d: number): boolean {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function toIso(y: number, m: number, d: number): string | null {
  if (!isValidCalendarDate(y, m, d)) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** 返回 YYYY-MM-DD 或 null */
export function extractDateFromPlainText(text: string): string | null {
  const s = text?.trim();
  if (!s) return null;

  // 1) ISO：2026-04-16
  const isoRe = /\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g;
  let m: RegExpExecArray | null;
  while ((m = isoRe.exec(s)) !== null) {
    const iso = toIso(+m[1], +m[2], +m[3]);
    if (iso) return iso;
  }

  // 2) 中文：2026年4月16日 / 2026年04月16日
  const zhRe = /(20\d{2})年\s*(0?[1-9]|1[0-2])\s*月\s*(0?[1-9]|[12]\d|3[01])\s*日/g;
  while ((m = zhRe.exec(s)) !== null) {
    const iso = toIso(+m[1], +m[2], +m[3]);
    if (iso) return iso;
  }

  // 3) 斜杠或点：2026/4/16、2026/04/16、2026.4.16
  const slashRe = /\b(20\d{2})[/.](0?[1-9]|1[0-2])[/.](0?[1-9]|[12]\d|3[01])\b/g;
  while ((m = slashRe.exec(s)) !== null) {
    const iso = toIso(+m[1], +m[2], +m[3]);
    if (iso) return iso;
  }

  return null;
}
