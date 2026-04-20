/**
 * @fileoverview 将 Apifox / 终端复制的 cURL 文本解析为结构化请求字段。
 * 支持常见形态：`curl`、`--request` / `-X`、`--header` / `-H`、`--data-raw` / `-d`（单引号多行体）。
 *
 * @module utils/parseCurl
 */

import type { ExternalApiHeaderRow } from "../types/externalApiProfile";

/** `parseCurl` 成功时的结构化结果。 */
export interface ParsedCurl {
  method: string;
  url: string;
  headers: ExternalApiHeaderRow[];
  body: string;
  warnings: string[];
}

/**
 * 从某下标起跳过空白，读取 `--data-raw='...'` 中 `=` 可选。
 * @returns 指向引号或正文起始的下标
 */
function skipKeyAndEquals(s: string, start: number): number {
  let p = start;
  while (p < s.length && /\s/.test(s[p]!)) p++;
  if (s[p] === "=") {
    p++;
    while (p < s.length && /\s/.test(s[p]!)) p++;
  }
  return p;
}

/**
 * 读取单引号包裹的跨行字符串（从 opening `'` 之后开始）。
 */
function readSingleQuoted(s: string, afterOpen: number): { content: string; end: number } | null {
  let i = afterOpen;
  let out = "";
  while (i < s.length) {
    const c = s[i]!;
    if (c === "'") return { content: out, end: i + 1 };
    out += c;
    i++;
  }
  return null;
}

/**
 * 读取双引号包裹的字符串，支持 `\` 转义下一字符。
 */
function readDoubleQuoted(s: string, afterOpen: number): { content: string; end: number } | null {
  let i = afterOpen;
  let out = "";
  while (i < s.length) {
    const c = s[i]!;
    if (c === "\\" && i + 1 < s.length) {
      out += s[i + 1]!;
      i += 2;
      continue;
    }
    if (c === '"') return { content: out, end: i + 1 };
    out += c;
    i++;
  }
  return null;
}

/**
 * 解析 cURL 文本；无法识别 URL 或格式严重错误时抛出 Error。
 * @param input 原始粘贴内容
 */
export function parseCurl(input: string): ParsedCurl {
  const warnings: string[] = [];
  let s = input.trim();
  if (!s) throw new Error("内容为空");

  if (/^curl\b/i.test(s)) {
    s = s.slice(4).trimStart();
  }

  s = s.replace(/\\\r?\n/g, "\n");

  const methodMatch = s.match(/\B(?:--request|-X)\s+([A-Za-z]+)\b/);
  let method = methodMatch ? methodMatch[1]!.toUpperCase() : "GET";

  const urlQuoted = s.match(/['"](https?:\/\/[^'"]+)['"]/);
  let url = urlQuoted ? urlQuoted[1]! : "";
  if (!url) {
    const bare = s.match(/\b(https?:\/\/[^\s'"]+)/);
    url = bare ? bare[1]! : "";
  }
  if (!url) throw new Error("未找到 http(s) URL，请确认用引号包裹或粘贴完整 cURL");

  const headers: ExternalApiHeaderRow[] = [];
  const headerPattern = /\B(?:--header|-H)\s+(['"])([\s\S]*?)\1/g;
  let hm: RegExpExecArray | null;
  while ((hm = headerPattern.exec(s)) !== null) {
    const line = hm[2]!.trim();
    const colon = line.indexOf(":");
    if (colon <= 0) {
      warnings.push(`跳过无法解析的请求头行：${line.slice(0, 48)}`);
      continue;
    }
    headers.push({
      key: line.slice(0, colon).trim(),
      value: line.slice(colon + 1).trim(),
    });
  }

  let body = "";
  const dataMarkers: { key: string; re: RegExp }[] = [
    { key: "--data-raw", re: /\B--data-raw\b/ },
    { key: "--data-binary", re: /\B--data-binary\b/ },
    { key: "--data", re: /\B--data\b/ },
    { key: "-d", re: /\B-d\b/ },
  ];

  for (const { re } of dataMarkers) {
    const m = re.exec(s);
    if (!m || m.index === undefined) continue;
    const afterKeyword = m.index + m[0].length;
    let p = skipKeyAndEquals(s, afterKeyword);
    if (p >= s.length) continue;

    if (s[p] === "'") {
      const rq = readSingleQuoted(s, p + 1);
      if (rq) {
        body = rq.content;
        if (!methodMatch) method = "POST";
        break;
      }
    }
    if (s[p] === '"') {
      const rq = readDoubleQuoted(s, p + 1);
      if (rq) {
        body = rq.content;
        if (!methodMatch) method = "POST";
        break;
      }
    }
  }

  if (!body && /\B(?:--data-raw|--data-binary|--data|-d)\b/.test(s)) {
    warnings.push("检测到 data 参数但未能解析请求体，请使用引号包裹 body 或检查是否闭合");
  }

  return { method, url, headers, body, warnings };
}
