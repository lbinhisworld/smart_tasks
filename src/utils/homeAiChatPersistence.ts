/**
 * @fileoverview 数据看板 AI 助手聊天记录：localStorage 持久化，切换页面后可恢复。
 */

export type PipelineStepStatusPersisted = "waiting" | "running" | "done" | "error";

export type PipelineStepPersisted = {
  actionName: string;
  status: PipelineStepStatusPersisted;
  resultFeedback?: string;
};

export type AssistantPipelinePersisted = {
  steps: PipelineStepPersisted[];
};

export type SkillReviseStatusPersisted = "running" | "done" | "error";

export type SkillReviseBubblePersisted = {
  stepActionName: string;
  stepLabel: string;
  status: SkillReviseStatusPersisted;
  changeSummary?: string;
  error?: string;
};

export type StoredChatMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | { role: "assistant"; pipeline: AssistantPipelinePersisted; pipelineContext?: { isReport: boolean } }
  | { role: "assistant"; skillRevise: SkillReviseBubblePersisted };

const CHAT_STORAGE_KEY = "qifeng_home_ai_chat_messages_v1";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseMessage(raw: unknown): StoredChatMessage | null {
  if (!isRecord(raw) || raw.role !== "user" && raw.role !== "assistant") return null;
  if (raw.role === "user") {
    const text = typeof raw.text === "string" ? raw.text : "";
    return { role: "user", text };
  }
  if ("skillRevise" in raw && isRecord(raw.skillRevise)) {
    const sr = raw.skillRevise;
    const stepActionName = typeof sr.stepActionName === "string" ? sr.stepActionName : "";
    const stepLabel = typeof sr.stepLabel === "string" ? sr.stepLabel : "";
    const st = sr.status;
    if (st !== "running" && st !== "done" && st !== "error") return null;
    const changeSummary = typeof sr.changeSummary === "string" ? sr.changeSummary : undefined;
    const error = typeof sr.error === "string" ? sr.error : undefined;
    if (!stepActionName.trim()) return null;
    return {
      role: "assistant",
      skillRevise: { stepActionName, stepLabel, status: st, changeSummary, error },
    };
  }
  if ("pipeline" in raw && isRecord(raw.pipeline)) {
    const stepsRaw = raw.pipeline.steps;
    if (!Array.isArray(stepsRaw)) return null;
    const steps: PipelineStepPersisted[] = [];
    for (const s of stepsRaw) {
      if (!isRecord(s)) continue;
      const actionName = typeof s.actionName === "string" ? s.actionName : "";
      const status = s.status;
      if (status !== "waiting" && status !== "running" && status !== "done" && status !== "error") continue;
      const resultFeedback = typeof s.resultFeedback === "string" ? s.resultFeedback : undefined;
      steps.push({ actionName, status, resultFeedback });
    }
    if (steps.length === 0) return null;
    const ctx = raw.pipelineContext;
    const pipelineContext =
      isRecord(ctx) && typeof ctx.isReport === "boolean" ? { isReport: ctx.isReport } : undefined;
    return { role: "assistant", pipeline: { steps }, pipelineContext };
  }
  const text = typeof raw.text === "string" ? raw.text : "";
  return { role: "assistant", text };
}

/** 页面刷新/返回后：将未跑完的 running 步骤标为中断，避免一直转圈 */
export function normalizeStoredMessages(messages: StoredChatMessage[]): StoredChatMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "assistant") return msg;
    if ("skillRevise" in msg) {
      if (msg.skillRevise.status !== "running") return msg;
      return {
        ...msg,
        skillRevise: {
          ...msg.skillRevise,
          status: "error",
          error: "上次会话未在页面内完成提示词优化，请重新提交修改意见。",
        },
      };
    }
    if (!("pipeline" in msg)) return msg;
    const steps = msg.pipeline.steps.map((s) => {
      if (s.status !== "running") return s;
      return {
        ...s,
        status: "error" as const,
        resultFeedback: s.resultFeedback ?? "上次会话未在页面内跑完，请重新发起查询。",
      };
    });
    return { ...msg, pipeline: { steps } };
  });
}

export function loadStoredChatMessages(): StoredChatMessage[] | null {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw?.trim()) return null;
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return null;
    const out: StoredChatMessage[] = [];
    for (const el of data) {
      const m = parseMessage(el);
      if (m) out.push(m);
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

export function saveStoredChatMessages(messages: StoredChatMessage[]): void {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
  } catch {
    /* 配额等 */
  }
}

export function clearStoredChatMessages(): void {
  try {
    localStorage.removeItem(CHAT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
