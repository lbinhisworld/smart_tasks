/**
 * @fileoverview 新建任务后向企业微信「智能表格」Webhook 推送一行记录；支持开发环境经 Vite 代理绕过 CORS。
 *
 * @module utils/smartsheetTaskPush
 */

import type { Task } from "../types/task";
import { isIsoDateString, PENDING_EXPECTED_COMPLETION } from "./taskDueDate";
import {
  getSmartsheetWebhookUrl,
  SMARTSHEET_WEBHOOK_PURPOSE_TASK,
} from "./smartsheetWebhooksStorage";
import {
  enrichSmartsheetFieldNotFoundMessage,
  loadTaskSmartsheetFieldIds,
} from "./smartsheetTaskFieldIdsStorage";

/**
 * 将企业微信「列不存在」类 errmsg 扩展为含本地 field_id 对照的说明。
 * @param raw 接口返回的 `errmsg`
 */
function normalizeSmartsheetApiErrorMessage(raw: string): string {
  if (/field not found|Smartsheet field/i.test(raw)) {
    return enrichSmartsheetFieldNotFoundMessage(raw);
  }
  return raw;
}


/**
 * 读取「任务督办」业务对应的 Webhook（业务标识 `task`）。
 */
export function getTaskSmartsheetWebhookUrl(): string | null {
  return getSmartsheetWebhookUrl(SMARTSHEET_WEBHOOK_PURPOSE_TASK);
}

/** @deprecated 使用 {@link getTaskSmartsheetWebhookUrl} */
export function getStoredSmartsheetWebhookUrl(): string | null {
  return getTaskSmartsheetWebhookUrl();
}

/**
 * 期待完成：有效 `YYYY-MM-DD` 转为本地日期正午的毫秒时间戳字符串；「待定」或无效则为空串（不传无意义时间戳）。
 */
export function expectedCompletionToSmartsheetMs(raw: string): string {
  const t = raw.trim();
  if (!t || t === PENDING_EXPECTED_COMPLETION) return "";
  if (!isIsoDateString(t)) return "";
  const ms = new Date(`${t}T12:00:00`).getTime();
  return Number.isFinite(ms) ? String(ms) : "";
}

/**
 * 接收 / 配合部门展示串（与任务列表一致）。
 */
function receiverDepartmentsText(task: Task): string {
  if (task.receiverDepartments?.length) return task.receiverDepartments.join("、");
  return task.receiverDepartment?.trim() ?? "";
}

/**
 * 构造智能表格 `add_records` 请求体。
 * 与你在 Apifox 中验证成功的写法对齐：**文本类列用简单字符串**；日期列用毫秒时间戳**字符串**（见[添加记录 Webhook](https://developer.work.weixin.qq.com/document/path/101240)）。
 * 空内容列不写 key，避免占位。
 */
export function buildSmartsheetAddRecordsBody(task: Task): {
  add_records: { values: Record<string, string> }[];
} {
  const fid = loadTaskSmartsheetFieldIds();
  const values: Record<string, string> = {};

  const putId = (id: string | undefined, v: string) => {
    const key = id?.trim();
    if (!key) return;
    values[key] = v;
  };

  const putStrCol = (id: string | undefined, raw: string) => {
    const t = raw.trim();
    if (!t) return;
    putId(id, t);
  };

  putStrCol(fid.initiator, task.initiator ?? "");
  putStrCol(fid.department, task.department ?? "");
  putStrCol(fid.executingDepartment, task.executingDepartment ?? "");
  putStrCol(fid.receiver, receiverDepartmentsText(task));
  putStrCol(fid.category, task.category ?? "");
  putStrCol(fid.taskMotivation, task.taskMotivation ?? "");
  putStrCol(fid.description, task.description ?? "");

  const dueMs = expectedCompletionToSmartsheetMs(task.expectedCompletion ?? "").trim();
  if (dueMs) putId(fid.expectedCompletionMs, dueMs);

  putStrCol(fid.status, task.status ?? "");

  return { add_records: [{ values }] };
}

/**
 * 开发环境下将 `https://qyapi.weixin.qq.com/...` 转为同源 `/api/qy-wedoc/...`，由 Vite 代理转发。
 */
export function resolveSmartsheetWebhookFetchUrl(webhookUrl: string): string {
  const trimmed = webhookUrl.trim();
  try {
    const u = new URL(trimmed);
    if (import.meta.env.DEV && u.hostname === "qyapi.weixin.qq.com") {
      return `/api/qy-wedoc${u.pathname}${u.search}`;
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * POST JSON 到 Webhook；非 2xx 或企业微信 `errcode !== 0` 时抛错。
 */
async function postSmartsheetWebhook(webhookUrl: string, body: unknown): Promise<void> {
  const url = resolveSmartsheetWebhookFetchUrl(webhookUrl);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
  try {
    const j = JSON.parse(text) as { errcode?: number; errmsg?: string };
    if (typeof j.errcode === "number" && j.errcode !== 0) {
      const raw = j.errmsg?.trim() || `errcode ${j.errcode}`;
      throw new Error(normalizeSmartsheetApiErrorMessage(raw));
    }
  } catch (e) {
    if (e instanceof SyntaxError) return;
    throw e;
  }
}

/**
 * 执行一次推送（未配置 Webhook 时抛错，便于手动重试提示）。
 */
export async function pushTaskToSmartsheetOnce(task: Task): Promise<void> {
  const hook = getTaskSmartsheetWebhookUrl();
  if (!hook) {
    throw new Error(
      "未配置「任务督办」Webhook：请在「系统配置 → 智能表格推送」中为业务标识 task 填写完整 URL。",
    );
  }
  await postSmartsheetWebhook(hook, buildSmartsheetAddRecordsBody(task));
}

/**
 * 新建任务后异步推送：成功 / 失败写回任务字段。
 * 未配置 Webhook 时记为失败（便于任务列表出现「推送智能表」与错误提示），避免静默跳过。
 * @param task 刚创建的任务行
 * @param updateTask 与 `TaskContext.updateTask` 一致
 */
export function schedulePushNewTaskToSmartsheet(
  task: Task,
  updateTask: (id: string, patch: Partial<Task>) => void,
): void {
  const hook = getTaskSmartsheetWebhookUrl();
  if (!hook) {
    const msg =
      "未配置「任务督办」Webhook：请点击顶部「设置」→「智能表格推送」，在业务标识为 task 的行填写完整 Webhook URL 后保存，再点本行「推送智能表」重试。";
    console.warn("[smartsheet]", task.code, msg);
    updateTask(task.id, { smartsheetPushStatus: "failed", smartsheetPushError: msg });
    return;
  }
  void (async () => {
    try {
      console.info("[smartsheet] 开始推送任务到智能表格", task.code);
      const body = buildSmartsheetAddRecordsBody(task);
      await postSmartsheetWebhook(hook, body);
      updateTask(task.id, { smartsheetPushStatus: "success", smartsheetPushError: undefined });
      console.info("[smartsheet] 推送成功", task.code);
      if (import.meta.env.DEV) {
        console.info("[smartsheet] 请求体", body);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[smartsheet] 推送失败", task.code, msg);
      updateTask(task.id, { smartsheetPushStatus: "failed", smartsheetPushError: msg.slice(0, 1200) });
    }
  })();
}
