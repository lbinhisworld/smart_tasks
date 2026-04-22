/**
 * @fileoverview 外部 HTTP 接口配置（数据中台页）：用于保存请求方法、URL、请求头与可选请求体。
 *
 * @module types/externalApiProfile
 */

/** 数据源 / 平台（用于左侧分组，如 ERP、CRM）。 */
export interface DataPlatform {
  id: string;
  name: string;
}

/** 一条 HTTP 请求头（键值对）。 */
export interface ExternalApiHeaderRow {
  key: string;
  value: string;
}

/**
 * 单条外部接口配置。
 * 敏感信息（如 Bearer）仅存于浏览器 localStorage，勿写入仓库。
 */
export interface ExternalApiProfile {
  id: string;
  /** 所属数据源（平台）id */
  platformId: string;
  /** 展示名称 */
  name: string;
  /** 是否启用（预留，便于后续自动同步筛选） */
  enabled: boolean;
  method: string;
  url: string;
  headers: ExternalApiHeaderRow[];
  /** 原始请求体文本；JSON 时请保持合法 JSON 字符串 */
  body: string;
  notes: string;
  updatedAt: number;
  /** 最近一次「测试」时间戳（毫秒） */
  lastTestAt?: number;
  /** 最近一次测试结果摘要 */
  lastTestSummary?: string;
  lastTestOk?: boolean;
  /**
   * 业务数据表格中要展示的列名（与 `extractBusinessRowsFromJson` 产出的列名一致）。
   * 未设置表示展示全部列且顺序与解析结果一致；空数组表示不展示任何列。
   * 非空时**数组顺序即为表格列顺序**（可小于全部列，表示仅展示勾选列并按此顺序）。
   */
  visibleBusinessFields?: string[];
  /**
   * 「清洗后的 JSON」页签：自然语言描述的清洗规则（保存后随原始 JSON 更新自动重算）。
   */
  jsonCleaningRules?: string;
  /**
   * 清洗方式：`script` 为本地脚本（新建接口默认）；`llm` 为自然语言 + 大模型。未持久化时由 `normalizeProfile` 按是否已有非空规则推断。
   */
  jsonCleaningMode?: "llm" | "script";
  /**
   * `jsonCleaningMode === "script"` 时的分组配置 JSON 字符串（见 `dataHubScriptCleaning` 类型）。
   */
  jsonCleaningScriptSpec?: string;
}
