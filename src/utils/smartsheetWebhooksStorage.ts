/**
 * @fileoverview 企业微信智能表格 Webhook：按「业务标识」多地址持久化（localStorage），并迁移旧版单键配置。
 *
 * @module utils/smartsheetWebhooksStorage
 */

const LEGACY_SINGLE_KEY = "qifeng_smartsheet_webhook_url";
const STATE_KEY = "qifeng_smartsheet_webhooks_v1";

/** 新建任务推送使用的业务标识（固定，与设置页第一行一致） */
export const SMARTSHEET_WEBHOOK_PURPOSE_TASK = "task";

interface WebhooksStateV1 {
  version: 1;
  /** 业务标识 → 完整 Webhook URL */
  webhooks: Record<string, string>;
}

/**
 * 预置业务标识在设置页的展示名称（未知 key 则直接显示 key）。
 */
export const SMARTSHEET_WEBHOOK_PURPOSE_LABELS: Record<string, string> = {
  [SMARTSHEET_WEBHOOK_PURPOSE_TASK]: "任务督办（新建任务推送）",
};

/**
 * 规范化 map：去掉空 key / 空 url。
 */
function sanitizeWebhooks(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    const key = k.trim();
    const url = (v ?? "").trim();
    if (!key || !url) continue;
    out[key] = url;
  }
  return out;
}

/**
 * 读取全部 Webhook 映射（不含迁移副作用的纯读；首次从旧单键迁移时会写入新结构并删旧键）。
 */
export function loadSmartsheetWebhooksMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed as WebhooksStateV1).version === 1 &&
        typeof (parsed as WebhooksStateV1).webhooks === "object" &&
        (parsed as WebhooksStateV1).webhooks !== null
      ) {
        return sanitizeWebhooks((parsed as WebhooksStateV1).webhooks);
      }
    }
    const legacy = localStorage.getItem(LEGACY_SINGLE_KEY)?.trim();
    if (legacy) {
      const next: Record<string, string> = { [SMARTSHEET_WEBHOOK_PURPOSE_TASK]: legacy };
      saveSmartsheetWebhooksMap(next);
      try {
        localStorage.removeItem(LEGACY_SINGLE_KEY);
      } catch {
        /* ignore */
      }
      return sanitizeWebhooks(next);
    }
  } catch {
    /* ignore */
  }
  return {};
}

/**
 * 覆盖保存 Webhook 映射。
 */
export function saveSmartsheetWebhooksMap(webhooks: Record<string, string>): void {
  const state: WebhooksStateV1 = { version: 1, webhooks: sanitizeWebhooks(webhooks) };
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/**
 * 按业务标识读取 Webhook URL；未配置则返回 `null`。
 */
export function getSmartsheetWebhookUrl(purpose: string): string | null {
  const k = purpose.trim();
  if (!k) return null;
  const url = loadSmartsheetWebhooksMap()[k]?.trim();
  return url || null;
}

/**
 * 供设置页编辑：保证包含 `task` 行（可为空 url），其余按 key 排序。
 */
export function getSmartsheetWebhookRowsForEditor(): { key: string; url: string }[] {
  const m = loadSmartsheetWebhooksMap();
  const rows: { key: string; url: string }[] = [];
  rows.push({ key: SMARTSHEET_WEBHOOK_PURPOSE_TASK, url: m[SMARTSHEET_WEBHOOK_PURPOSE_TASK] ?? "" });
  const rest = Object.keys(m)
    .filter((k) => k !== SMARTSHEET_WEBHOOK_PURPOSE_TASK)
    .sort((a, b) => a.localeCompare(b));
  for (const key of rest) {
    rows.push({ key, url: m[key] ?? "" });
  }
  return rows;
}

const PURPOSE_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/;

/**
 * 校验自定义业务标识（`task` 除外，由界面写死）。
 * @returns 错误信息；合法则返回 `null`
 */
export function validateCustomSmartsheetPurposeKey(key: string): string | null {
  const t = key.trim();
  if (!t) return "业务标识不能为空。";
  if (t === SMARTSHEET_WEBHOOK_PURPOSE_TASK) return "该标识为系统保留。";
  if (!PURPOSE_KEY_PATTERN.test(t)) {
    return "业务标识须以字母开头，仅含字母、数字、下划线、连字符，长度 1～48。";
  }
  return null;
}

/**
 * 将设置页行保存为 map；校验重复 key 与自定义 key 格式。
 * @returns 错误信息；成功则返回 `null` 并已写入 localStorage
 */
export function saveSmartsheetWebhookRowsFromEditor(rows: { key: string; url: string }[]): string | null {
  const map: Record<string, string> = {};
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.key.trim();
    const url = row.url.trim();
    if (!key) {
      if (url) return "存在未填写「业务标识」但已填写 Webhook URL 的行，请补全标识或清空该 URL。";
      continue;
    }
    if (key !== SMARTSHEET_WEBHOOK_PURPOSE_TASK) {
      const err = validateCustomSmartsheetPurposeKey(key);
      if (err) return err;
    }
    if (seen.has(key)) return `业务标识「${key}」重复，请合并或删除重复行。`;
    seen.add(key);
    if (!url) {
      if (key === SMARTSHEET_WEBHOOK_PURPOSE_TASK) continue;
      return `请为「${key}」填写 Webhook URL，或删除该行。`;
    }
    map[key] = url;
  }
  saveSmartsheetWebhooksMap(map);
  return null;
}
