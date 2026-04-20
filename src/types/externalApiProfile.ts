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
   * 未设置或空数组表示展示全部列。
   */
  visibleBusinessFields?: string[];
  /**
   * 「清洗后的 JSON」页签：自然语言描述的清洗规则（保存后随原始 JSON 更新自动重算）。
   */
  jsonCleaningRules?: string;
}
