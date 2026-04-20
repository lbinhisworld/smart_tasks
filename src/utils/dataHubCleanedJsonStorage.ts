/**
 * @fileoverview 数据中台「清洗后的 JSON」在 sessionStorage 中的键名与读取（与 DataSync 写入一致）。
 *
 * @module utils/dataHubCleanedJsonStorage
 */

/** sessionStorage 键前缀：`${PREFIX}${profileId}` */
export const DATA_HUB_CLEANED_JSON_PREFIX = "qifeng_data_hub_cleaned_json_";

/**
 * 读取某接口配置最近一次清洗后的 JSON 文本。
 * @param profileId 接口配置 id
 */
export function loadCleanedJsonFromSession(profileId: string): string | null {
  try {
    return sessionStorage.getItem(DATA_HUB_CLEANED_JSON_PREFIX + profileId);
  } catch {
    return null;
  }
}
