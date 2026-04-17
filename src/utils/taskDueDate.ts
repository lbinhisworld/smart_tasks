/** 无明确截止要求时的期待完成占位（与任务列表、表单一致） */
export const PENDING_EXPECTED_COMPLETION = "待定";

export function isIsoDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

/** 将模型或其它来源的期待完成字段规范为 YYYY-MM-DD 或「待定」 */
export function normalizeExpectedCompletion(raw: string): string {
  const t = raw.trim();
  if (!t) return PENDING_EXPECTED_COMPLETION;
  if (t === PENDING_EXPECTED_COMPLETION || t === "TBD" || t === "待确定") return PENDING_EXPECTED_COMPLETION;
  if (isIsoDateString(t)) return t;
  return PENDING_EXPECTED_COMPLETION;
}
