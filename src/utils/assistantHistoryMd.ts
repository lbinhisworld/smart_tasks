/**
 * @fileoverview AI 助手交互压缩历史：以 Markdown 形态持久化到 localStorage，逻辑上对应 `history.md`（可导出为同名文件）。
 *
 * - 每条交互压缩至约 100 字以内；
 * - 「滚动摘要 + 近期记录」核心文本超过 500 字时，整体再压缩为一条 ≤100 字的滚动摘要，近期清空后继续追加。
 */

const STORAGE_KEY = "qifeng_assistant_history_md_v1";

const MAX_SINGLE_ENTRY_CHARS = 100;
const MAX_ROLLED_CHARS = 100;
/** `history.md` 全文（含标题与列表符号）超过该字数时，将「滚动摘要 + 近期记录」整体再压缩为一条滚动摘要 */
const MAX_MARKDOWN_FILE_CHARS = 500;

export type AssistantHistoryTurnInput = {
  userText: string;
  /** 意图主题展示名，如「报告管理」 */
  topicLabel: string;
  /** 意图关键词/理由缩写 */
  topicKeywords: string;
  /** 数据范围条件描述（一步或合并文案） */
  scopeDescription: string;
  /** 具体记录 id 集（任务编号、提取历史 id 等） */
  recordIdsSummary: string;
  /** 最终应答摘要 */
  answerSummary: string;
};

type Persisted = {
  v: 1;
  /** 历次合并后的滚动摘要，≤100 字 */
  rolledSummary: string;
  /** 近期逐条压缩，每条 ≤100 字 */
  recent: string[];
};

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { v: 1, rolledSummary: "", recent: [] };
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return { v: 1, rolledSummary: "", recent: [] };
    const rec = o as Record<string, unknown>;
    const rolled = typeof rec.rolledSummary === "string" ? rec.rolledSummary : "";
    const r = rec.recent;
    const recent = Array.isArray(r)
      ? r.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)
      : [];
    return { v: 1, rolledSummary: rolled.trim(), recent };
  } catch {
    return { v: 1, rolledSummary: "", recent: [] };
  }
}

function savePersisted(p: Persisted): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* 配额满等 */
  }
}

function stripNoise(s: string): string {
  return s
    .replace(/[#*`_[\]()>]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\|/g, "｜")
    .trim();
}

function limitChars(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

/** 单轮交互压缩为一条，≤100 字 */
export function compressAssistantTurn(i: AssistantHistoryTurnInput): string {
  const q = limitChars(stripNoise(i.userText), 28);
  const kw = limitChars(stripNoise(i.topicKeywords), 12);
  const scope = limitChars(stripNoise(i.scopeDescription), 26);
  const ids = limitChars(stripNoise(i.recordIdsSummary), 22);
  const ans = limitChars(stripNoise(i.answerSummary), 20);
  const topic = limitChars(stripNoise(i.topicLabel), 8);
  const line = `问:${q}|意:${topic}/${kw}|范:${scope}|id:${ids}|答:${ans}`;
  return limitChars(line, MAX_SINGLE_ENTRY_CHARS);
}

/** 将多轮内容合并为一条滚动摘要，≤100 字 */
export function compressRolledHistory(fullCore: string): string {
  const flat = stripNoise(fullCore.replace(/\n/g, " "));
  const lines = fullCore.split("\n").filter((l) => l.trim());
  const n = lines.length;
  if (!flat) return "";
  let s = n > 1 ? `[${n}轮]${flat}` : flat;
  s = limitChars(s, 72);
  return limitChars(s, MAX_ROLLED_CHARS);
}

/** 序列化为可保存为 history.md 的正文 */
export function serializeAssistantHistoryMarkdown(p: Persisted): string {
  const head: string[] = ["# AI 助手交互压缩历史", ""];
  if (p.rolledSummary) {
    head.push("## 滚动摘要", "", `> ${p.rolledSummary}`, "");
  }
  head.push("## 近期记录", "");
  if (p.recent.length === 0) head.push("*（暂无）*", "");
  else for (const r of p.recent) head.push(`- ${r}`, "");
  return head.join("\n").trimEnd() + "\n";
}

/** 将当前持久化内容写成 Markdown 字符串并写回存储（与 JSON 结构同步） */
function persistMarkdownView(p: Persisted): void {
  savePersisted(p);
  try {
    localStorage.setItem(`${STORAGE_KEY}_markdown`, serializeAssistantHistoryMarkdown(p));
  } catch {
    /* ignore */
  }
}

/**
 * 追加一轮压缩记录，并在负载超过阈值时滚动合并。
 */
export function appendAssistantHistoryTurn(input: AssistantHistoryTurnInput): void {
  const line = compressAssistantTurn(input);
  const p = loadPersisted();
  p.recent.push(line);
  while (serializeAssistantHistoryMarkdown(p).length > MAX_MARKDOWN_FILE_CHARS) {
    const core = [p.rolledSummary, ...p.recent].filter(Boolean).join("\n");
    p.rolledSummary = compressRolledHistory(core);
    p.recent = [];
    if (!p.rolledSummary) break;
  }
  persistMarkdownView(p);
}

/** 读取当前 Markdown（优先镜像键，否则由 JSON 即时生成） */
export function readAssistantHistoryMarkdownFile(): string {
  try {
    const mirror = localStorage.getItem(`${STORAGE_KEY}_markdown`);
    if (mirror) return mirror;
  } catch {
    /* ignore */
  }
  return serializeAssistantHistoryMarkdown(loadPersisted());
}

/** 触发浏览器下载 `history.md` */
export function downloadAssistantHistoryMd(): void {
  const body = readAssistantHistoryMarkdownFile();
  const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "history.md";
  a.click();
  URL.revokeObjectURL(url);
}
