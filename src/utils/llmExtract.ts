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

/** 优先使用界面保存的 DeepSeek Key；否则回退到构建时环境变量（兼容旧配置）。 */
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

export async function callProductionReportExtraction(
  documentPlainText: string,
  env: LlmEnv,
  extractionDate: string = formatExtractionDate(),
): Promise<ProductionReportExtractionResult> {
  const body = documentPlainText.length > MAX_CHARS ? documentPlainText.slice(0, MAX_CHARS) : documentPlainText;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (env.apiKey) headers.Authorization = `Bearer ${env.apiKey}`;

  const dateBlock = `【系统给定】提取日期（YYYY-MM-DD，请原样写入 JSON 顶层「提取日期」；该值已由系统根据「正文可解析日期优先，否则为本次请求当日」确定）：${extractionDate}`;

  const t0 = performance.now();

  const res = await fetch(env.apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: env.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "你是造纸企业 COO 助手。严格只输出一个 JSON 对象：顶层须含「分公司名称」「提取日期」「production_report」；production_report 内叶子值为字符串；无信息用「暂无」。不要输出 markdown。",
        },
        {
          role: "user",
          content: `${REPORT_EXTRACTION_USER_INSTRUCTION}\n\n${dateBlock}\n\n---以下为待分析的日报/报告正文（纯文本）---\n\n${body}`,
        },
      ],
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

export function parseJsonSafe(raw: string): unknown {
  const s = raw.trim();
  return JSON.parse(s) as unknown;
}

/** 保证顶层含「分公司名称」「提取日期」；分公司名缺省为「暂无」；提取日期以本次解析的本地日期为准。 */
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
