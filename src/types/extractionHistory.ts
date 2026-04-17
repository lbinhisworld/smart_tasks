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

/** 单条量化指标在原文中的引用摘录（保存时由原文字面匹配生成） */
export interface QuantitativeMetricCitation {
  /** JSON 路径，如 production_report.2. 生产能效.计划值 */
  path: string;
  /** 末级键名，便于表格「指标」列展示 */
  metricLabel: string;
  /** 模型提取的指标值文本 */
  valueText: string;
  /**
   * `literal`：指标值来自正文直接字面；`auto_computed`：同父级下由计划值/实际值推算的偏差值、偏差率（见提取提示词）。
   * 省略时按字面理解，兼容旧数据。
   */
  sourceKind?: "literal" | "auto_computed";
  /** 在原文中命中指标值的起始下标；-1 表示未命中或自动计算行 */
  matchIndex: number;
  /** 引用片段在原文中的 [excerptStart, excerptEnd) */
  excerptStart?: number;
  excerptEnd?: number;
  /** 命中位置前后各约 50 字（与指标值长度合计裁剪） */
  excerpt: string;
  /** 在 `excerpt` 内要高亮的区间（通常为指标值字面，自动计算行为计划值/实际值条件字面） */
  excerptHighlights?: { start: number; end: number }[];
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
  /** 保存时生成的量化指标 → 原文引用（±50 字）；旧记录可能无此字段 */
  quantitativeMetricCitations?: QuantitativeMetricCitation[];
}
