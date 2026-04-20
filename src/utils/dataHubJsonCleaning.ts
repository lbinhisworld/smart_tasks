/**
 * @fileoverview 数据中台「清洗后的 JSON」：自然语言规则 + 原始 JSON → 模型输出再格式化为可读 JSON 文本。
 *
 * @module utils/dataHubJsonCleaning
 */

const MAX_JSON_IN_PROMPT = 100_000;

/**
 * 数据中台清洗请求使用的 `max_tokens`（完成侧上限）。
 * 未指定时各厂商默认多为 4096，长 JSON 易在句中被截断；设为 DeepSeek Chat 等常见上限 8192 以降低截断概率。
 */
export const DATA_HUB_JSON_CLEANING_MAX_COMPLETION_TOKENS = 8192;

/** 系统提示：仅输出合法 JSON 值。 */
export const DATA_HUB_JSON_CLEANING_SYSTEM =
  "你是 JSON 数据清洗助手。用户会提供「自然语言清洗规则」和「原始 JSON」。请严格依据规则从原始数据中筛选、重排或转换，输出且仅输出一个合法的 JSON（顶层为对象或数组均可）。不要输出 Markdown、不要代码围栏、不要任何解释性文字或前后缀。";

/**
 * 组装用户消息：清洗规则 + 原始 JSON。
 * @param rules 自然语言清洗规则
 * @param rawJsonText 接口返回的原始 JSON 字符串
 */
export function buildJsonCleaningUserMessage(rules: string, rawJsonText: string): string {
  const block =
    rawJsonText.length > MAX_JSON_IN_PROMPT
      ? `${rawJsonText.slice(0, MAX_JSON_IN_PROMPT)}\n\n…（原始 JSON 已截断，约 ${rawJsonText.length} 字符）`
      : rawJsonText;
  return `【清洗规则（自然语言）】\n${rules.trim() || "（请说明如何清洗）"}\n\n【原始 JSON】\n${block}`;
}

/**
 * 将模型返回整理为可读字符串；若能解析为 JSON 则 pretty-print。
 * @param modelText 模型原始输出
 */
export function formatCleanedJsonOutput(modelText: string): string {
  let t = modelText.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)```$/im.exec(t);
  if (fence) t = fence[1].trim();
  try {
    const j = JSON.parse(t) as unknown;
    return JSON.stringify(j, null, 2);
  } catch {
    return t;
  }
}
