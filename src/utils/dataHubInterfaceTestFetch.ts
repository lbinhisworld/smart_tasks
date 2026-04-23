/**
 * @fileoverview 与数据中台「发送测试请求」一致的 HTTP 调用：写 `sessionStorage` 响应缓存、更新接口 `lastTest*` 元数据（不修改清洗规则等其它字段）。
 * 供「报告管理 · 日报列表」刷新与 `fetchTalentPoolRaw` 等复用。
 *
 * @module utils/dataHubInterfaceTestFetch
 */

import type { ExternalApiHeaderRow, ExternalApiProfile } from "../types/externalApiProfile";
import { saveDataSyncLastBody } from "./dataSyncResponseStorage";
import { loadDataHubState, saveDataHubState } from "./externalApiStorage";

const TEST_TIMEOUT_MS = 30_000;
const RESPONSE_PREVIEW_MAX = 200_000;

/**
 * 将请求头表格行转为 `fetch` 可用的 `Headers` 对象字面量。
 *
 * @param rows 键值对列表
 */
function headersToRecord(rows: ExternalApiHeaderRow[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (const { key, value } of rows) {
    const k = key.trim();
    if (!k) continue;
    o[k] = value;
  }
  return o;
}

/**
 * 将接口最近一次测试结果写回 localStorage（与 DataSync 侧栏摘要一致）。
 *
 * @param profileId 接口 id
 * @param patch 要合并的字段
 */
function patchProfileLastTestMeta(
  profileId: string,
  patch: Pick<ExternalApiProfile, "lastTestAt" | "lastTestOk" | "lastTestSummary">,
): void {
  const { platforms, profiles } = loadDataHubState();
  const next = profiles.map((p) =>
    p.id === profileId ? { ...p, ...patch, updatedAt: Date.now() } : p,
  );
  saveDataHubState(platforms, next);
}

export interface RunDataHubInterfaceTestResult {
  /** HTTP 2xx 且无网络异常时为 true */
  ok: boolean;
  /** 与 `saveDataSyncLastBody` 写入的预览正文一致 */
  body: string;
  /** 失败时的说明（含 HTTP 非 2xx、超时、网络错误） */
  error?: string;
  httpStatus?: number;
  /** 往返耗时（毫秒） */
  durationMs: number;
}

/**
 * 执行与数据中台「接口基础配置」中「发送测试请求」相同的请求，并将会话缓存、接口元数据与数据中台保持一致。
 *
 * @param profile 当前选中的接口配置（须含 URL、方法、请求头、请求体）
 */
export async function runDataHubInterfaceTestFetch(
  profile: ExternalApiProfile,
): Promise<RunDataHubInterfaceTestResult> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), TEST_TIMEOUT_MS);
  const t0 = performance.now();

  const method = profile.method.trim().toUpperCase() || "GET";
  const headers = headersToRecord(profile.headers);
  const hasBody = ["POST", "PUT", "PATCH", "DELETE"].includes(method) && profile.body.trim().length > 0;
  if (hasBody && !headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }

  try {
    const res = await fetch(profile.url, {
      method,
      headers,
      body: hasBody ? profile.body : undefined,
      signal: ctrl.signal,
    });
    const durationMs = Math.round(performance.now() - t0);
    const text = await res.text();
    const preview =
      text.length > RESPONSE_PREVIEW_MAX
        ? `${text.slice(0, RESPONSE_PREVIEW_MAX)}\n\n…（已截断，原始长度 ${text.length} 字符）`
        : text;

    saveDataSyncLastBody(profile.id, preview);

    const summary = `HTTP ${res.status} · ${durationMs} ms · 响应约 ${text.length} 字符`;
    patchProfileLastTestMeta(profile.id, {
      lastTestAt: Date.now(),
      lastTestOk: res.ok,
      lastTestSummary: summary,
    });

    if (res.ok) {
      return { ok: true, body: preview, httpStatus: res.status, durationMs };
    }
    return {
      ok: false,
      body: preview,
      httpStatus: res.status,
      durationMs,
      error: `HTTP ${res.status}`,
    };
  } catch (e) {
    const durationMs = Math.round(performance.now() - t0);
    const msg =
      e instanceof Error
        ? e.name === "AbortError"
          ? `请求超时（>${TEST_TIMEOUT_MS / 1000}s）或已中止`
          : e.message
        : String(e);
    patchProfileLastTestMeta(profile.id, {
      lastTestAt: Date.now(),
      lastTestOk: false,
      lastTestSummary: `失败：${msg.slice(0, 120)}`,
    });
    return { ok: false, body: "", durationMs, error: msg };
  } finally {
    window.clearTimeout(timer);
  }
}
