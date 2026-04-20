/**
 * @fileoverview 按接口配置 id 缓存最近一次测试响应体（sessionStorage），供「数据列表」页签展示。
 *
 * @module utils/dataSyncResponseStorage
 */

const PREFIX = "qifeng_data_sync_last_body_";
const MAX_LEN = 500_000;

/**
 * 写入最近一次响应正文；超长时截断。
 * @param profileId 接口配置 id
 * @param body 原始响应字符串
 */
export function saveDataSyncLastBody(profileId: string, body: string): void {
  try {
    const t = body.length > MAX_LEN ? `${body.slice(0, MAX_LEN)}\n/* …截断，原始 ${body.length} 字符 */` : body;
    sessionStorage.setItem(PREFIX + profileId, t);
  } catch {
    /* quota / private mode */
  }
}

/**
 * 读取最近一次响应正文。
 * @param profileId 接口配置 id
 */
export function loadDataSyncLastBody(profileId: string): string | null {
  try {
    return sessionStorage.getItem(PREFIX + profileId);
  } catch {
    return null;
  }
}
