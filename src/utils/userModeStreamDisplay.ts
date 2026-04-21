/**
 * @fileoverview 用户模式：将流式累积正文压成固定 3 行字幕（满 3 行后滚动丢弃最早一行）。
 */

const LINE_CHAR_BUDGET = 56;

/** 按换行取末 3 行；若不足 3 行则对整段按字符切分填充（适合单行 JSON 流）。 */
export function rollingThreeSubtitleLines(accumulated: string): [string, string, string] {
  const norm = accumulated.replace(/\r/g, "");
  const byNl = norm.split("\n").filter((l, i, a) => i < a.length - 1 || l.length > 0);
  if (byNl.length >= 3) {
    const t = byNl.slice(-3);
    return [truncateLine(t[0]!), truncateLine(t[1]!), truncateLine(t[2]!)];
  }
  const one = norm.replace(/\n/g, " ").trim();
  if (!one) return ["", "", ""];
  const chunks: string[] = [];
  for (let i = 0; i < one.length; i += LINE_CHAR_BUDGET) {
    chunks.push(one.slice(i, i + LINE_CHAR_BUDGET));
  }
  const tail = chunks.slice(-3);
  while (tail.length < 3) tail.unshift("");
  return [tail[0] ?? "", tail[1] ?? "", tail[2] ?? ""];
}

function truncateLine(s: string): string {
  const t = s.trim();
  if (t.length <= LINE_CHAR_BUDGET + 8) return t;
  return `…${t.slice(-(LINE_CHAR_BUDGET + 4))}`;
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 答复「打字机」：优先按行吐出（短行整行），否则每次前进约 2 个码元。
 */
export function nextRevealEnd(full: string, start: number): number {
  if (start >= full.length) return full.length;
  const slice = full.slice(start);
  const nl = slice.indexOf("\n");
  if (nl === 0) return start + 1;
  if (nl > 0 && nl <= 48) return start + nl + 1;
  return Math.min(full.length, start + 2);
}
