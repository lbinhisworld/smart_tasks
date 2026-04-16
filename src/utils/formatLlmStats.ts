import type { LlmCallStats } from "../types/extractionHistory";

export function formatTokenCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("zh-CN");
}

export function formatLlmDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatLlmStatsParts(s: LlmCallStats): string[] {
  return [
    `模型 ${s.model}`,
    `输入 ${formatTokenCount(s.inputTokens)} tokens`,
    `输出 ${formatTokenCount(s.outputTokens)} tokens`,
    `耗时 ${formatLlmDurationMs(s.durationMs)}`,
  ];
}
