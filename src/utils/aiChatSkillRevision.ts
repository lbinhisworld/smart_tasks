/**
 * @fileoverview 根据用户反馈调用大模型修订 ai_chat_skill 中的环节提示词，并写入修订日志（localStorage + 导出 ai_chat_skill_update.md）。
 */

import type { LlmEnv } from "./llmExtract";
import { callLlmChatJsonObject } from "./llmExtract";
import {
  AI_CHAT_SKILL_KEY_LABEL,
  type AiChatSkillKey,
  getSkillPartRaw,
  setSkillPart,
} from "./aiChatSkillStore";

const UPDATE_LOG_JSON_KEY = "qifeng_ai_chat_skill_updates_json_v1";
const UPDATE_LOG_MD_MIRROR_KEY = "qifeng_ai_chat_skill_updates_md_v1";

export type SkillRevisionLogEntry = {
  at: string;
  skillKey: AiChatSkillKey;
  stepLabel: string;
  changeSummary: string;
  beforeExcerpt: string;
  afterExcerpt: string;
};

const REVISER_SYSTEM = `你是企业内 AI 助手的「提示词工程师」。用户会给出【环节名称】【当前 system 提示词正文】与【修改意见】。

请输出**一个 JSON 对象**（不要 markdown 代码围栏），恰好包含：
- "revised_prompt"：字符串，修订后的**完整** system 提示词正文；须保留业务必需的占位符（若原文有）：\`{{CORE_MEMORY}}\`、\`{{TASK_DYNAMIC_MEMORY}}\`、\`{{REPORT_DYNAMIC_MEMORY}}\`。
- "change_summary"：字符串，2～5 句中文，分号或换行分隔，概括相对原文的**主要修改**（要具体，勿空泛）。

Constraints：revised_prompt 为可直接用作 chat completion 的 system 内容；不要输出除 JSON 外任何文字。`;

function excerpt(s: string, max = 480): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function loadLogEntries(): SkillRevisionLogEntry[] {
  try {
    const raw = localStorage.getItem(UPDATE_LOG_JSON_KEY);
    if (!raw) return [];
    const a = JSON.parse(raw) as unknown;
    if (!Array.isArray(a)) return [];
    return a.filter((x): x is SkillRevisionLogEntry => x && typeof x === "object");
  } catch {
    return [];
  }
}

function saveLogEntries(entries: SkillRevisionLogEntry[]): void {
  try {
    localStorage.setItem(UPDATE_LOG_JSON_KEY, JSON.stringify(entries));
    localStorage.setItem(UPDATE_LOG_MD_MIRROR_KEY, serializeUpdateLogMarkdown(entries));
  } catch {
    /* ignore */
  }
}

export function serializeUpdateLogMarkdown(entries: SkillRevisionLogEntry[]): string {
  const head = `# ai_chat_skill 修订日志

本文件由应用根据「优化」操作自动生成，存于浏览器 localStorage；导出即为 ai_chat_skill_update.md。

`;
  if (entries.length === 0) return `${head}*（尚无修订记录）*\n`;
  const blocks = entries.map((e) => {
    const title = AI_CHAT_SKILL_KEY_LABEL[e.skillKey] ?? e.skillKey;
    return `## ${e.at} · ${e.stepLabel}（${title}）

**主要修改**：${e.changeSummary}

**修改前（节选）**：

> ${e.beforeExcerpt}

**修改后（节选）**：

> ${e.afterExcerpt}

`;
  });
  return head + blocks.join("\n");
}

export function readSkillUpdateMarkdown(): string {
  try {
    const mirror = localStorage.getItem(UPDATE_LOG_MD_MIRROR_KEY);
    if (mirror) return mirror;
  } catch {
    /* ignore */
  }
  return serializeUpdateLogMarkdown(loadLogEntries());
}

export function downloadSkillUpdateMd(): void {
  const body = readSkillUpdateMarkdown();
  const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "chat_skill_update.md";
  a.click();
  URL.revokeObjectURL(url);
}

export type SkillRevisionResult =
  | { ok: true; changeSummary: string }
  | { ok: false; error: string };

export async function reviseSkillPromptWithFeedback(
  env: LlmEnv,
  params: {
    skillKey: AiChatSkillKey;
    stepLabel: string;
    userFeedback: string;
  },
): Promise<SkillRevisionResult> {
  const before = getSkillPartRaw(params.skillKey);
  const userPayload = `【环节】${params.stepLabel}（${AI_CHAT_SKILL_KEY_LABEL[params.skillKey]}）

【当前 system 提示词正文】
${before}

【用户修改意见】
${params.userFeedback.trim()}`;

  let raw: string;
  try {
    const res = await callLlmChatJsonObject(env, REVISER_SYSTEM, userPayload, 8192);
    raw = res.content;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }

  let revised = "";
  let changeSummary = "";
  try {
    const o = JSON.parse(raw.trim()) as Record<string, unknown>;
    revised = typeof o.revised_prompt === "string" ? o.revised_prompt.trim() : "";
    changeSummary = typeof o.change_summary === "string" ? o.change_summary.trim() : "";
  } catch {
    return { ok: false, error: "模型返回非 JSON，无法解析 revised_prompt" };
  }

  if (!revised) return { ok: false, error: "模型未返回有效的 revised_prompt" };

  setSkillPart(params.skillKey, revised);

  const entry: SkillRevisionLogEntry = {
    at: new Date().toISOString(),
    skillKey: params.skillKey,
    stepLabel: params.stepLabel,
    changeSummary: changeSummary || "（模型未给出 change_summary）",
    beforeExcerpt: excerpt(before),
    afterExcerpt: excerpt(revised),
  };
  const next = [...loadLogEntries(), entry];
  saveLogEntries(next);

  return { ok: true, changeSummary: entry.changeSummary };
}
