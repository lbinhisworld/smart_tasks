/**
 * @fileoverview 大模型调用记录：浏览器 localStorage，供「系统配置 → LLM 调用记录」时间线展示。
 */

const STORAGE_KEY = "qifeng_llm_call_log_v1";
export const LLM_CALL_LOG_CHANGED_EVENT = "qifeng-llm-call-log-changed";

const MAX_ENTRIES = 60;
const MAX_FIELD_CHARS = 120_000;

export type LlmCallLogResponseMode = "json_object" | "text";

export type LlmCallLogEntry = {
  id: string;
  at: number;
  inputText: string;
  outputText: string;
  error?: string;
  model?: string;
  durationMs?: number | null;
  responseMode?: LlmCallLogResponseMode;
  finishReason?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
};

type Persisted = { v: 1; entries: LlmCallLogEntry[] };

function trimField(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n…（已截断，原始长度 ${s.length} 字符）`;
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { v: 1, entries: [] };
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return { v: 1, entries: [] };
    const rec = o as Record<string, unknown>;
    const entries = rec.entries;
    if (!Array.isArray(entries)) return { v: 1, entries: [] };
    const list = entries.filter((x): x is LlmCallLogEntry => {
      if (!x || typeof x !== "object") return false;
      const e = x as Record<string, unknown>;
      return (
        typeof e.id === "string" &&
        typeof e.at === "number" &&
        typeof e.inputText === "string" &&
        typeof e.outputText === "string"
      );
    });
    return { v: 1, entries: list };
  } catch {
    return { v: 1, entries: [] };
  }
}

function save(p: Persisted): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* quota 等：尽力保留最近若干条 */
    try {
      const half = { v: 1 as const, entries: p.entries.slice(0, Math.max(1, Math.floor(p.entries.length / 2))) };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(half));
    } catch {
      /* ignore */
    }
  }
  try {
    window.dispatchEvent(new Event(LLM_CALL_LOG_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

export function readLlmCallLogs(): LlmCallLogEntry[] {
  const { entries } = load();
  return [...entries].sort((a, b) => b.at - a.at);
}

export function clearLlmCallLogs(): void {
  save({ v: 1, entries: [] });
}

export function appendLlmCallLog(entry: Omit<LlmCallLogEntry, "id" | "inputText" | "outputText"> & {
  id?: string;
  inputText: string;
  outputText: string;
}): void {
  const p = load();
  const row: LlmCallLogEntry = {
    id: entry.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    at: entry.at,
    inputText: trimField(entry.inputText, MAX_FIELD_CHARS),
    outputText: trimField(entry.outputText, MAX_FIELD_CHARS),
    error: entry.error,
    model: entry.model,
    durationMs: entry.durationMs ?? null,
    responseMode: entry.responseMode,
    finishReason: entry.finishReason ?? null,
    inputTokens: entry.inputTokens ?? null,
    outputTokens: entry.outputTokens ?? null,
  };
  p.entries.push(row);
  while (p.entries.length > MAX_ENTRIES) {
    p.entries.shift();
  }
  save(p);
}

/** 将 chat messages 拼成可读的一段「输入文字」 */
export function formatChatMessagesForLog(messages: { role: string; content: string }[]): string {
  return messages
    .map((m) => {
      const label = m.role === "system" ? "系统" : m.role === "user" ? "用户" : m.role === "assistant" ? "助手" : m.role;
      return `【${label}】\n${m.content}`;
    })
    .join("\n\n---\n\n");
}
