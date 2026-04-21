/**
 * @fileoverview 任务推送至企业微信智能表格时，`values` 中的列字段 id（每张表不同，需在设置中配置）。
 *
 * @module utils/smartsheetTaskFieldIdsStorage
 */

const STORAGE_KEY = "qifeng_smartsheet_task_field_map_v1";

/** 与任务模型语义对应的字段键（顺序用于设置页展示） */
export const TASK_SMARTSHEET_FIELD_KEYS = [
  "initiator",
  "department",
  "executingDepartment",
  "receiver",
  "category",
  "taskMotivation",
  "description",
  "expectedCompletionMs",
  "status",
] as const;

export type TaskSmartsheetFieldKey = (typeof TASK_SMARTSHEET_FIELD_KEYS)[number];

/** 设置页中文说明 */
export const TASK_SMARTSHEET_FIELD_LABELS: Record<TaskSmartsheetFieldKey, string> = {
  initiator: "发起人",
  department: "发起部门",
  executingDepartment: "执行部门",
  receiver: "接收 / 配合部门",
  category: "类别",
  taskMotivation: "任务动因",
  description: "描述",
  expectedCompletionMs: "期待完成（毫秒时间戳列）",
  status: "状态",
};

/**
 * 需求文档示例表中的默认字段 id；若企业微信报「field not found」，请在设置中改为当前表的真实 id。
 */
export const DEFAULT_TASK_SMARTSHEET_FIELD_IDS: Record<TaskSmartsheetFieldKey, string> = {
  initiator: "f6SjhW",
  department: "fZH7pY",
  executingDepartment: "f16De8",
  receiver: "fKbWx2",
  category: "fJHWpA",
  taskMotivation: "fLPVvn",
  description: "feD5kT",
  expectedCompletionMs: "f5RQdB",
  status: "fyPpwG",
};

interface FieldMapStateV1 {
  version: 1;
  fields: Record<TaskSmartsheetFieldKey, string> | Partial<Record<TaskSmartsheetFieldKey, string>>;
}

function isFieldKey(k: string): k is TaskSmartsheetFieldKey {
  return (TASK_SMARTSHEET_FIELD_KEYS as readonly string[]).includes(k);
}

/**
 * 智能表格列 field_id：短串（如 `f6SjhW`）或部分环境下「纯数字」长 id 均可能出现；须与 Webhook「示例数据」JSON 中 key 完全一致。
 */
const FIELD_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * @param id 待校验的列字段 id
 * @returns 是否符合写入本地存储的格式
 */
export function isValidTaskSmartsheetFieldId(id: string): boolean {
  return FIELD_ID_PATTERN.test(id.trim());
}

/**
 * 读取合并后的字段 id（未配置的项使用文档示例默认值）。
 * 若 localStorage 中某项格式非法（如误存了时间戳、docid），则忽略该项并回退为默认值，避免推送时带上错误 key。
 */
export function loadTaskSmartsheetFieldIds(): Record<TaskSmartsheetFieldKey, string> {
  const base = { ...DEFAULT_TASK_SMARTSHEET_FIELD_IDS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as FieldMapStateV1).version !== 1 ||
      typeof (parsed as FieldMapStateV1).fields !== "object" ||
      (parsed as FieldMapStateV1).fields === null
    ) {
      return base;
    }
    const f = (parsed as FieldMapStateV1).fields;
    for (const k of Object.keys(f)) {
      if (!isFieldKey(k)) continue;
      const v = f[k];
      if (typeof v !== "string") continue;
      const t = v.trim();
      if (!t) continue;
      if (!isValidTaskSmartsheetFieldId(t)) {
        if (import.meta.env.DEV) {
          console.warn(
            `[smartsheet] 忽略非法列 field_id（${TASK_SMARTSHEET_FIELD_LABELS[k]}）：${t.slice(0, 80)}`,
          );
        }
        continue;
      }
      base[k] = t;
    }
    return base;
  } catch {
    return base;
  }
}

/**
 * 在「field not found」类错误后附加：当前各语义列配置的 field_id、以及对 hint 的解读（便于与 Apifox / 示例数据对照）。
 * @param errmsg 企业微信返回的 `errmsg` 原文
 * @returns 增强后的说明文案
 */
export function enrichSmartsheetFieldNotFoundMessage(errmsg: string): string {
  const ids = loadTaskSmartsheetFieldIds();
  const compactLine = TASK_SMARTSHEET_FIELD_KEYS.map(
    (k) => `${TASK_SMARTSHEET_FIELD_LABELS[k]}=${ids[k]}`,
  ).join("；");
  let out = errmsg.trimEnd();
  const m = errmsg.match(/hint:\s*\[([^\]]+)\]/i);
  if (m?.[1]) {
    const hintId = m[1].trim();
    const keys = TASK_SMARTSHEET_FIELD_KEYS.filter((k) => ids[k] === hintId);
    if (keys.length) {
      out += `\n\n与 hint 一致的本地配置列为「${keys.map((k) => TASK_SMARTSHEET_FIELD_LABELS[k]).join("、")}」。若仍报错，说明该 id 不是当前 Webhook 所绑定子表中的列 id，请到企业微信该 Webhook 的「示例数据」中复制本表真实 field_id。`;
    } else {
      out += `\n\nhint「${hintId}」与当前本地配置的各列 id 均不完全相同：多为「Webhook 与子表/列」与文档示例不一致。请打开该 Webhook 的「示例数据」，将其中每个字段的 key 原样填入本系统「设置 → 智能表格推送」对应行（支持短串或数字串列 id）。`;
    }
  }
  out += `\n\n当前本地列 field_id 一览：${compactLine}。\n请在「设置 → 智能表格推送」中修改并保存后，再点「推送智能表」重试。`;
  return out;
}

/**
 * 校验并保存任务推送列字段 id；全部须非空且互不重复。
 * @returns 错误文案；成功返回 `null`
 */
export function saveTaskSmartsheetFieldIds(ids: Record<TaskSmartsheetFieldKey, string>): string | null {
  const normalized: Record<TaskSmartsheetFieldKey, string> = { ...DEFAULT_TASK_SMARTSHEET_FIELD_IDS };
  for (const key of TASK_SMARTSHEET_FIELD_KEYS) {
    const t = (ids[key] ?? "").trim();
    if (!t) {
      return `请填写「${TASK_SMARTSHEET_FIELD_LABELS[key]}」对应的智能表格列字段 id。`;
    }
    if (!isValidTaskSmartsheetFieldId(t)) {
      return `「${TASK_SMARTSHEET_FIELD_LABELS[key]}」的字段 id 格式无效（须与示例数据一致：仅含字母、数字、下划线、连字符，长度 1～64，可为 f6SjhW 或纯数字串等）。`;
    }
    normalized[key] = t;
  }
  const seen = new Set<string>();
  for (const key of TASK_SMARTSHEET_FIELD_KEYS) {
    const id = normalized[key];
    if (seen.has(id)) {
      return `列字段 id「${id}」被重复使用（${TASK_SMARTSHEET_FIELD_LABELS[key]} 与其它列冲突）。每张智能表格中每列 id 须唯一。`;
    }
    seen.add(id);
  }
  try {
    const state: FieldMapStateV1 = { version: 1, fields: normalized };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    return "无法写入本地存储，请检查浏览器是否禁止 localStorage。";
  }
  return null;
}

/**
 * 恢复为内置文档示例字段 id（删除本地覆盖）。
 */
export function resetTaskSmartsheetFieldIdsToDefaults(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
