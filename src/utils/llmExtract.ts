/**
 * @fileoverview LLM 调用与生产日报结构化提取：环境读取（DeepSeek 优先 / 构建变量回退）、`fetch` 请求、JSON 规范化。
 *
 * **设计要点**
 * - `readLlmEnv`：用户若在界面保存 DeepSeek Key，则走 dev 代理 `/api/deepseek` 或直连官方 URL；否则读 `VITE_*` 兼容旧部署。
 * - `callProductionReportExtraction`：正文截断 `MAX_CHARS`；`response_format: json_object`；系统提示约束顶层字段形状，用户消息拼接固定提取说明与「提取日期」块。
 * - `normalizeProductionReportJson`：落库前补全/覆盖顶层「分公司名称」「提取日期」，避免模型漏字段导致看板/时间线断裂。
 * - Key 变更通过 `LLM_CONFIG_CHANGED_EVENT` 广播，配置弹窗与提取页可同步刷新。
 *
 * @module llmExtract
 */

import { REPORT_EXTRACTION_USER_INSTRUCTION } from "../constants/reportExtractionPrompt";

export interface LlmEnv {
  apiUrl: string;
  apiKey: string;
  model: string;
}

const STORAGE_KEY = "qifeng_deepseek_api_key";
export const LLM_CONFIG_CHANGED_EVENT = "qifeng-llm-config-changed";

const DEEPSEEK_CHAT_URL = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";

export function getStoredDeepseekApiKey(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v?.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function setStoredDeepseekApiKey(key: string): void {
  const t = key.trim();
  if (!t) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, t);
  }
  window.dispatchEvent(new Event(LLM_CONFIG_CHANGED_EVENT));
}

export function clearStoredDeepseekApiKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(LLM_CONFIG_CHANGED_EVENT));
}

function readLlmEnvFromBuildEnv(): LlmEnv | null {
  const viaProxy = import.meta.env.VITE_LLM_VIA_PROXY === "1" && import.meta.env.DEV;
  if (viaProxy) {
    const model =
      (import.meta.env.VITE_LLM_MODEL as string | undefined)?.trim() || "gpt-4o-mini";
    return { apiUrl: "/api/llm", apiKey: "", model };
  }
  const apiKey = import.meta.env.VITE_LLM_API_KEY as string | undefined;
  if (!apiKey?.trim()) return null;
  const apiUrl =
    (import.meta.env.VITE_LLM_API_URL as string | undefined)?.trim() ||
    "https://api.openai.com/v1/chat/completions";
  const model = (import.meta.env.VITE_LLM_MODEL as string | undefined)?.trim() || "gpt-4o-mini";
  return { apiUrl, apiKey: apiKey.trim(), model };
}

/**
 * 解析当前可用的 LLM 环境：优先界面持久化的 DeepSeek Key，否则 `VITE_LLM_*`；开发期可 `VITE_LLM_VIA_PROXY=1` 走 `/api/llm`。
 * @returns 未配置任何可用密钥/代理时 `null`
 */
export function readLlmEnv(): LlmEnv | null {
  const ds = getStoredDeepseekApiKey();
  if (ds) {
    const apiUrl = import.meta.env.DEV ? "/api/deepseek" : DEEPSEEK_CHAT_URL;
    return { apiUrl, apiKey: ds, model: DEEPSEEK_MODEL };
  }
  return readLlmEnvFromBuildEnv();
}

const MAX_CHARS = 120_000;

/** 本地日历日 YYYY-MM-DD（用于「提取日期」字段） */
export function formatExtractionDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface ProductionReportExtractionResult {
  content: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  durationMs: number;
}

type ChatRoleMessage = { role: "system" | "user" | "assistant"; content: string };

async function postChatCompletionJson(
  env: LlmEnv,
  messages: ChatRoleMessage[],
  temperature = 0.2,
): Promise<ProductionReportExtractionResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (env.apiKey) headers.Authorization = `Bearer ${env.apiKey}`;

  const t0 = performance.now();

  const res = await fetch(env.apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: env.model,
      temperature,
      response_format: { type: "json_object" },
      messages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`模型接口错误 ${res.status}: ${errText.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    model?: string;
    choices?: { message?: { content?: string } }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };

  const durationMs = Math.round(performance.now() - t0);

  const content = data.choices?.[0]?.message?.content;
  if (!content?.trim()) throw new Error("模型返回为空。");

  const u = data.usage;
  const promptTokens =
    typeof u?.prompt_tokens === "number" && Number.isFinite(u.prompt_tokens) ? u.prompt_tokens : null;
  const completionTokens =
    typeof u?.completion_tokens === "number" && Number.isFinite(u.completion_tokens)
      ? u.completion_tokens
      : null;
  const totalTokens =
    typeof u?.total_tokens === "number" && Number.isFinite(u.total_tokens) ? u.total_tokens : null;

  const model =
    typeof data.model === "string" && data.model.trim() ? data.model.trim() : env.model;

  return {
    content: content.trim(),
    model,
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    totalTokens,
    durationMs,
  };
}

/**
 * 通用 JSON 对象补全：自定义 system / user，与日报提取共用同一鉴权与端点。
 */
export async function callLlmChatJsonObject(
  env: LlmEnv,
  systemContent: string,
  userContent: string,
): Promise<ProductionReportExtractionResult> {
  return postChatCompletionJson(env, [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ]);
}

/**
 * 调用聊天补全接口，将日报正文转为结构化 JSON 字符串（模型侧约束为单对象）。
 *
 * @param documentPlainText - 已抽取的纯文本；超长时截断至 `MAX_CHARS`
 * @param env - 端点、密钥、模型名
 * @param extractionDate - 写入用户消息块，要求模型原样写入顶层「提取日期」
 * @throws 非 2xx、空 content、网络错误
 */
export async function callProductionReportExtraction(
  documentPlainText: string,
  env: LlmEnv,
  extractionDate: string = formatExtractionDate(),
): Promise<ProductionReportExtractionResult> {
  const body = documentPlainText.length > MAX_CHARS ? documentPlainText.slice(0, MAX_CHARS) : documentPlainText;

  const dateBlock = `【系统给定】提取日期（YYYY-MM-DD，请原样写入 JSON 顶层「提取日期」；该值已由系统根据「正文可解析日期优先，否则为本次请求当日」确定）：${extractionDate}`;

  return postChatCompletionJson(env, [
    {
      role: "system",
      content:
        "你是造纸企业 COO 助手。严格只输出一个 JSON 对象：顶层须含「分公司名称」「提取日期」「production_report」；production_report 下每个一级主题对象内须含与下级并列的字符串键「范围」（分公司或车间名）；其余叶子值为字符串；无信息用「暂无」。不要输出 markdown。",
    },
    {
      role: "user",
      content: `${REPORT_EXTRACTION_USER_INSTRUCTION}\n\n${dateBlock}\n\n---以下为待分析的日报/报告正文（纯文本）---\n\n${body}`,
    },
  ]);
}

/** 薄封装 `JSON.parse`；调用方负责 try/catch 或确信输入合法。 */
export function parseJsonSafe(raw: string): unknown {
  const s = raw.trim();
  return JSON.parse(s) as unknown;
}

/**
 * 解析模型输出字符串，保证顶层含「分公司名称」「提取日期」；解析失败时原样返回 `raw`。
 * 「提取日期」强制为入参 `extractionDate`，与请求阶段约定一致。
 */
export function normalizeProductionReportJson(raw: string, extractionDate: string): string {
  try {
    const o = JSON.parse(raw.trim()) as Record<string, unknown>;
    const branch = o["分公司名称"];
    if (typeof branch !== "string" || !branch.trim()) {
      o["分公司名称"] = "暂无";
    }
    o["提取日期"] = extractionDate;
    return JSON.stringify(o);
  } catch {
    return raw;
  }
}
