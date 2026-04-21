/**
 * @fileoverview 轻量 CSV 文本解析：支持双引号字段、字段内逗号、`""` 转义。
 *
 * @module parseCsvText
 */

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * @param text - 完整 CSV 文本（UTF-8）
 * @returns 行数组；跳过末尾空行
 */
export function parseCsvText(text: string): string[][] {
  const raw = text.replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/);
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  return nonEmpty.map(parseCsvLine);
}
