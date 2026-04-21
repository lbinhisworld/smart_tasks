/**
 * @fileoverview AI 助手四环节提示词：`docs/ai_chat_skill.md` 为默认源，运行时覆盖存 localStorage，可导出为 ai_chat_skill.md。
 */

import defaultSkillMarkdown from "../../docs/ai_chat_skill.md?raw";
import { getCoreMemoryText } from "./coreMemoryStorage";
import { getAssistantHistoryForRouter } from "./assistantHistoryMd";
import { loadReportDynamicMemoryText } from "./reportDynamicMemory";
import { loadTaskDynamicMemoryText } from "./taskDynamicMemory";

const STORAGE_KEY = "qifeng_ai_chat_skill_md_v1";

export type AiChatSkillKey =
  | "intent"
  | "data_scope_general"
  | "data_scope_report"
  | "data_record_tasks"
  | "data_record_report"
  | "final_answer";

export const AI_CHAT_SKILL_KEY_LABEL: Record<AiChatSkillKey, string> = {
  intent: "意图判断",
  data_scope_general: "数据范围判断（非报告）",
  data_scope_report: "数据范围判断（报告）",
  data_record_tasks: "数据记录判断（任务/综合）",
  data_record_report: "数据记录判断（报告）",
  final_answer: "具体数据返回",
};

const STANDARD_PREAMBLE = `# AI 助手环节提示词（ai_chat_skill）

运行时从本文件加载默认值；用户在界面「优化」修订后的全文保存在浏览器 localStorage，可通过「导出 ai_chat_skill.md」下载同步。

**占位符（请勿删除，除非明确改为不注入动态块）：**

- \`{{CORE_MEMORY}}\`：替换为《核心记忆模块》全文。
- \`{{ASSISTANT_HISTORY}}\`：替换为当前 \`history.md\` 压缩历史（主题路由、**数据范围判断**等均会注入；过长自动截断保留更近内容）。
- \`{{TASK_DYNAMIC_MEMORY}}\`、\`{{REPORT_DYNAMIC_MEMORY}}\`：替换为任务 / 日报动态记忆文本。

---
`;

function parseH2Block(md: string, title: string): string | null {
  const lines = md.split(/\r?\n/);
  const startTag = `## ${title}`;
  let i = 0;
  while (i < lines.length && lines[i].trim() !== startTag) i++;
  if (i >= lines.length) return null;
  i++;
  const buf: string[] = [];
  while (i < lines.length && !/^##\s/.test(lines[i])) {
    buf.push(lines[i]);
    i++;
  }
  return buf.join("\n").trim();
}

function parseH3(block: string, subtitle: string): string | null {
  const lines = block.split(/\r?\n/);
  const tag = `### ${subtitle}`;
  let i = 0;
  while (i < lines.length && lines[i].trim() !== tag) i++;
  if (i >= lines.length) return null;
  i++;
  const buf: string[] = [];
  while (i < lines.length) {
    const line = lines[i];
    if (/^###\s/.test(line) || /^##\s/.test(line)) break;
    buf.push(line);
    i++;
  }
  return buf.join("\n").trim();
}

export function parseSkillPartsFromMarkdown(md: string): Partial<Record<AiChatSkillKey, string>> {
  const intentBlock = parseH2Block(md, "意图判断");
  const scopeBlock = parseH2Block(md, "数据范围判断");
  const recordBlock = parseH2Block(md, "数据记录判断");
  const finalBlock = parseH2Block(md, "具体数据返回");

  const out: Partial<Record<AiChatSkillKey, string>> = {};
  if (intentBlock) out.intent = intentBlock;
  if (scopeBlock) {
    const g = parseH3(scopeBlock, "非报告主题");
    const r = parseH3(scopeBlock, "报告主题");
    if (g) out.data_scope_general = g;
    if (r) out.data_scope_report = r;
  }
  if (recordBlock) {
    const t = parseH3(recordBlock, "任务与综合主题");
    const r = parseH3(recordBlock, "报告主题");
    if (t) out.data_record_tasks = t;
    if (r) out.data_record_report = r;
  }
  if (finalBlock) out.final_answer = finalBlock;
  return out;
}

function buildSkillMarkdown(parts: Record<AiChatSkillKey, string>): string {
  return `${STANDARD_PREAMBLE.trimEnd()}

## 意图判断

${parts.intent.trim()}

## 数据范围判断

### 非报告主题

${parts.data_scope_general.trim()}

### 报告主题

${parts.data_scope_report.trim()}

## 数据记录判断

### 任务与综合主题

${parts.data_record_tasks.trim()}

### 报告主题

${parts.data_record_report.trim()}

## 具体数据返回

${parts.final_answer.trim()}
`;
}

function defaultParts(): Record<AiChatSkillKey, string> {
  const parsed = parseSkillPartsFromMarkdown(defaultSkillMarkdown.trim());
  const keys: AiChatSkillKey[] = [
    "intent",
    "data_scope_general",
    "data_scope_report",
    "data_record_tasks",
    "data_record_report",
    "final_answer",
  ];
  const out = {} as Record<AiChatSkillKey, string>;
  for (const k of keys) {
    const v = parsed[k]?.trim();
    if (!v) throw new Error(`ai_chat_skill default missing: ${k}`);
    out[k] = v;
  }
  return out;
}

let cachedDefaults: Record<AiChatSkillKey, string> | null = null;

function getDefaultParts(): Record<AiChatSkillKey, string> {
  if (!cachedDefaults) cachedDefaults = defaultParts();
  return cachedDefaults;
}

/** 当前生效的完整 Markdown（含 localStorage 覆盖） */
export function getAiChatSkillMarkdown(): string {
  try {
    const s = localStorage.getItem(STORAGE_KEY)?.trim();
    if (s) return s;
  } catch {
    /* ignore */
  }
  return buildSkillMarkdown(getDefaultParts());
}

export function getSkillParts(): Record<AiChatSkillKey, string> {
  const merged = parseSkillPartsFromMarkdown(getAiChatSkillMarkdown());
  const defaults = getDefaultParts();
  const out = { ...defaults };
  for (const k of Object.keys(merged) as AiChatSkillKey[]) {
    const v = merged[k]?.trim();
    if (v) out[k] = v;
  }
  return out;
}

export function setAiChatSkillMarkdown(fullMd: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, fullMd.trim());
  } catch {
    /* ignore */
  }
}

/** 保存前校验主要 ## 标题是否存在（缺失时环节解析可能回退到内置默认）。 */
export function validateAiChatSkillMarkdownShape(md: string): string | null {
  const need = ["## 意图判断", "## 数据范围判断", "## 数据记录判断", "## 具体数据返回"];
  for (const h of need) {
    if (!md.includes(h)) return `正文中缺少「${h}」，保存后部分环节可能仍使用内置默认片段。`;
  }
  return null;
}

export function setSkillPart(key: AiChatSkillKey, body: string): void {
  const parts = getSkillParts();
  parts[key] = body.trim();
  setAiChatSkillMarkdown(buildSkillMarkdown(parts));
}

export function resetAiChatSkillToBundledDefault(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** 主题判断 system 提示（已注入核心记忆 + history.md 压缩历史） */
export function resolveTopicRouterSystemPrompt(): string {
  const history = getAssistantHistoryForRouter();
  const rawIntent = getSkillParts().intent;
  const hadHistoryPlaceholder = rawIntent.includes("{{ASSISTANT_HISTORY}}");
  let s = rawIntent
    .replace(/\{\{CORE_MEMORY\}\}/g, getCoreMemoryText().trim())
    .replace(/\{\{ASSISTANT_HISTORY\}\}/g, history);
  if (!hadHistoryPlaceholder && !s.includes("【近期交互压缩历史（history.md）】")) {
    const marker = "【你必须输出的 JSON】";
    const idx = s.indexOf(marker);
    const block = `\n【近期交互压缩历史（history.md）】\n${history}\n\n`;
    if (idx >= 0) s = s.slice(0, idx) + block + s.slice(idx);
    else s += block;
  }
  return s;
}

function injectAssistantHistoryIntoDataScopePrompt(raw: string): string {
  const history = getAssistantHistoryForRouter();
  let s = raw.replace(/\{\{ASSISTANT_HISTORY\}\}/g, history);
  const hasBlock = s.includes("【近期交互压缩历史（history.md）】");
  const hadPlaceholder = raw.includes("{{ASSISTANT_HISTORY}}");
  if (!hadPlaceholder && !hasBlock) {
    const markers = ["只输出一个 JSON", "【你必须输出的 JSON】"];
    let idx = -1;
    for (const m of markers) {
      idx = s.indexOf(m);
      if (idx >= 0) break;
    }
    const block = `\n【近期交互压缩历史（history.md）】\n${history}\n\n`;
    if (idx >= 0) s = s.slice(0, idx) + block + s.slice(idx);
    else s = `${block}${s}`;
  }
  return s;
}

export function resolveDataScopeGeneralSystemPrompt(): string {
  return injectAssistantHistoryIntoDataScopePrompt(getSkillParts().data_scope_general);
}

export function resolveDataScopeReportSystemPrompt(): string {
  return injectAssistantHistoryIntoDataScopePrompt(getSkillParts().data_scope_report);
}

export function resolveDataRecordTasksSystemPrompt(): string {
  const raw = getSkillParts().data_record_tasks;
  return raw
    .replace(/\{\{TASK_DYNAMIC_MEMORY\}\}/g, loadTaskDynamicMemoryText())
    .replace(/\{\{REPORT_DYNAMIC_MEMORY\}\}/g, loadReportDynamicMemoryText());
}

export function resolveReportDataRecordSystemPrompt(): string {
  return getSkillParts().data_record_report;
}

export function resolveFinalDataAnswerSystemPrompt(): string {
  return getSkillParts().final_answer;
}

/** 取某一环节的「静态」正文（占位符不展开，供优化/修订展示） */
export function getSkillPartRaw(key: AiChatSkillKey): string {
  return getSkillParts()[key];
}

export function downloadAiChatSkillMd(): void {
  const body = getAiChatSkillMarkdown();
  const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "chat_skill.md";
  a.click();
  URL.revokeObjectURL(url);
}

/** 根据流水线步骤与是否报告主题，映射到 skill 键（第 4 步报告与第 3 步共用报告数据记录提示词） */
export function skillKeyForPipelineStep(
  stepIndex: number,
  isReport: boolean,
): { key: AiChatSkillKey; label: string } | null {
  switch (stepIndex) {
    case 0:
      return { key: "intent", label: "意图判断" };
    case 1:
      return {
        key: isReport ? "data_scope_report" : "data_scope_general",
        label: "数据范围判断",
      };
    case 2:
      return {
        key: isReport ? "data_record_report" : "data_record_tasks",
        label: "数据记录判断",
      };
    case 3:
      return isReport
        ? { key: "data_record_report", label: "具体数据返回（报告应答）" }
        : { key: "final_answer", label: "具体数据返回" };
    default:
      return null;
  }
}
