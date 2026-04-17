/**
 * @fileoverview LLM 用量与耗时的展示格式化（中文 locale、缺省占位「—」）。
 *
 * @module formatLlmStats
 */

import type { LlmCallStats } from "../types/extractionHistory";

/** @returns 非有限数时「—」，否则中文千分位 */
export function formatTokenCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("zh-CN");
}

/** 小于 1s 显示毫秒，否则一位小数秒 */
export function formatLlmDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** 拼成多行标签用字符串片段，供列表/详情逐行展示 */
export function formatLlmStatsParts(s: LlmCallStats): string[] {
  return [
    `模型 ${s.model}`,
    `输入 ${formatTokenCount(s.inputTokens)} tokens`,
    `输出 ${formatTokenCount(s.outputTokens)} tokens`,
    `耗时 ${formatLlmDurationMs(s.durationMs)}`,
  ];
}
