/** 单次大模型调用的用量与耗时（兼容接口未返回 usage 字段） */
export interface LlmCallStats {
  /** 实际使用的模型名（优先接口返回） */
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  /** 从发起请求到收到完整响应的耗时（毫秒） */
  durationMs: number;
}

/** 单次「保存」后的提取历史记录（parsedJson 为可 JSON 序列化的对象或 null） */
export interface ExtractionHistoryItem {
  id: string;
  savedAt: string;
  /** 列表标题：日期-分公司名（新保存记录会写入） */
  displayTitle?: string;
  fileName: string;
  /** 大模型类型、token、耗时（保存时写入） */
  llmStats?: LlmCallStats;
  /** 从上传文件中抽取的完整原文 */
  originalText: string;
  /** 大模型返回的原始字符串 */
  rawModelResponse: string;
  /** 解析成功时的对象；失败为 null */
  parsedJson: unknown | null;
}
