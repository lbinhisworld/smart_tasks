/**
 * @fileoverview 数据看板 AI 助手：单次查询四动作流水线（主题判断 → 数据范围 → 数据记录 → 具体数据返回），每步「我正在进行【…】」+ 动画，完成后 ✅ 与结果反馈语。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { REPORT_PRODUCTION_STRUCTURE_DOC } from "../constants/reportProductionStructuredSchemaDoc";
import { useTasks } from "../context/TaskContext";
import { loadExtractionHistory } from "../utils/extractionHistoryStorage";
import {
  extractionItemsToLlmRows,
  pickHistoryByIds,
  pickTasksByCodes,
  tasksToLlmRows,
} from "../utils/homeAssistantDataRows";
import {
  ASSISTANT_REPORT_CHAIN_DONE_EVENT,
  ASSISTANT_REPORT_PARSE_RESULT_EVENT,
  dispatchAssistantReportParse,
  dispatchAssistantSetReportManualText,
  dispatchAssistantUiActions,
  type AssistantReportChainDoneDetail,
  type AssistantReportParseResultDetail,
} from "../utils/assistantUiActions";
import {
  applyInquiryTopicHistoryFallback,
  coerceOperationModeForReportIntake,
  coerceOperationModeForTaskManualNew,
  DAILY_REPORT_BODY_MIN_LEN,
  getDailyReportBodyFromOperationInfo,
  buildDataRecordSystemPrompt,
  buildDataRecordUserPayload,
  buildDataScopeSystemPrompt,
  buildDataScopeSystemPromptForReport,
  buildDataScopeUserPayload,
  buildFinalDataAnswerSystemPrompt,
  buildFinalDataAnswerUserPayload,
  buildOperationConfirmSystemPrompt,
  buildOperationConfirmUserPayload,
  buildOperationExecuteSystemPrompt,
  buildOperationExecuteUserPayload,
  buildReportDataRecordSystemPrompt,
  buildReportDataRecordUserPayload,
  buildTopicRouterSystemPrompt,
  buildTopicRouterUserPayload,
  type DataScopeBaselineIds,
  formatReportDataScopeFeedback,
  formatTopicBlock,
  inferOfflineIntentSummary,
  inferOfflineInteractionMode,
  inferOfflineTopic,
  parseDataRecordJson,
  parseDataScopeJson,
  parseDataScopeReportJson,
  parseFinalAnswerJson,
  normalizeReportIntakeConfirm,
  parseOperationConfirmJson,
  parseOperationExecuteJson,
  parseReportDataRecordJudgmentJson,
  parseTopicRouterJson,
  runAssistantOperationUiActions,
  shouldAwaitDailyReportBodyInChat,
  topicChineseLabel,
  type ReportDataScopeResult,
  type TopicRouterResult,
} from "../utils/homeAssistantPrompt";
import { buildReportStructuredArrayForLlm } from "../utils/homeAssistantReportPayload";
import { callLlmChatJsonObject, readLlmEnv } from "../utils/llmExtract";
import { nextRevealEnd, rollingThreeSubtitleLines, sleepMs } from "../utils/userModeStreamDisplay";
import { extractionHistoryVisibleForPerspective } from "../utils/leaderPerspective";
import { appendAssistantHistoryTurn } from "../utils/assistantHistoryMd";
import { skillKeyForOperationPipelineStep, skillKeyForPipelineStep } from "../utils/aiChatSkillStore";
import { reviseSkillPromptWithFeedback } from "../utils/aiChatSkillRevision";
import {
  loadStoredChatMessages,
  normalizeStoredMessages,
  saveStoredChatMessages,
  type AssistantPipelineContextPersisted,
  type AssistantPipelinePersisted as AssistantPipeline,
  type StoredChatMessage as ChatMessage,
} from "../utils/homeAiChatPersistence";
import {
  filterExtractionHistoryByReportScope,
  inferIsoDatesFromChineseQuestion,
  resolveReportDatesAgainstVisibleHistory,
} from "../utils/reportExtractionScopeFilter";
import { runHomeAiUserModePipeline, type UserModeStreamStage } from "../utils/homeAiUserModePipeline";

export type { PipelineStepStatusPersisted as PipelineStepStatus } from "../utils/homeAiChatPersistence";
export type { PipelineStepPersisted as PipelineStep } from "../utils/homeAiChatPersistence";
export type { AssistantPipelinePersisted as AssistantPipeline } from "../utils/homeAiChatPersistence";

const ASSISTANT_UI_MODE_KEY = "qifeng_home_ai_ui_mode_v1";

type UserModeLiveState = {
  stageLabel: string;
  lines: [string, string, string];
  phase: "streaming" | "done" | "final-waiting";
};

const ROUTER_FALLBACK: TopicRouterResult = {
  interaction_mode: "inquiry",
  topic: "general",
  topic_rationale: "未能解析主题路由结果，已按「综合或其它」处理。",
};

function buildAssistantWelcome(perspective: string): string {
  const p = perspective.trim() || "用户";
  return `尊敬的【${p}】，欢迎使用齐峰新材重点任务管理系统。`;
}

/** 调试模式：环节反馈区附加模型原文时的最大长度 */
const DEBUG_PIPELINE_RAW_RETURN_MAX_CHARS = 14_000;

function appendDebugModelRawReturn(summary: string, rawContent: string): string {
  const raw = rawContent.trim() || "（空）";
  const clipped =
    raw.length > DEBUG_PIPELINE_RAW_RETURN_MAX_CHARS
      ? `${raw.slice(0, DEBUG_PIPELINE_RAW_RETURN_MAX_CHARS)}\n…（已截断，完整内容以网络响应为准）`
      : raw;
  return `${summary}\n\n【模型返回原文】\n${clipped}`;
}

function createInitialPipeline(): AssistantPipeline {
  return {
    steps: [
      { actionName: "主题判断", status: "running" },
      { actionName: "数据范围判断", status: "waiting" },
      { actionName: "数据记录判断", status: "waiting" },
      { actionName: "具体数据返回", status: "waiting" },
    ],
  };
}

function patchLastPipeline(messages: ChatMessage[], fn: (p: AssistantPipeline) => AssistantPipeline): ChatMessage[] {
  const last = messages.length - 1;
  if (last < 0) return messages;
  const tail = messages[last];
  if (tail.role !== "assistant" || !("pipeline" in tail)) return messages;
  return [...messages.slice(0, last), { ...tail, pipeline: fn(tail.pipeline) }];
}

function patchLastPipelineWithContext(
  messages: ChatMessage[],
  ctx: AssistantPipelineContextPersisted,
): ChatMessage[] {
  const last = messages.length - 1;
  if (last < 0) return messages;
  const tail = messages[last];
  if (tail.role !== "assistant" || !("pipeline" in tail)) return messages;
  return [...messages.slice(0, last), { ...tail, pipelineContext: ctx }];
}

function SkillReviseBubbleLine({
  skillRevise,
}: {
  skillRevise: import("../utils/homeAiChatPersistence").SkillReviseBubblePersisted;
}) {
  const { status, stepActionName, changeSummary, error } = skillRevise;
  const headline =
    status === "running"
      ? `正在优化【${stepActionName}】技能描述`
      : status === "done"
        ? `已完成优化【${stepActionName}】技能描述`
        : `优化【${stepActionName}】技能描述未成功`;
  return (
    <div className="home-ai-skill-revise">
      <div className="home-ai-skill-revise-cue">
        <span>{headline}</span>
        {status === "running" && <span className="home-ai-pipeline-spin" aria-hidden />}
        {status === "done" && (
          <span className="home-ai-pipeline-check" aria-label="已完成">
            ✅
          </span>
        )}
        {status === "error" && (
          <span className="home-ai-pipeline-err" aria-label="失败">
            ✕
          </span>
        )}
      </div>
      {status === "done" && (
        <>
          <p className="muted small home-ai-skill-revise-donehint">
            已根据你的意见更新该环节提示词（已写入本地 ai_chat_skill，可在系统配置中导出备份）。
          </p>
          {changeSummary?.trim() && (
            <div className="home-ai-skill-revise-summary">
              <div className="home-ai-skill-revise-summary-label">主要修改</div>
              <div className="home-ai-skill-revise-summary-md">
                <ReactMarkdown>{changeSummary.trim()}</ReactMarkdown>
              </div>
            </div>
          )}
        </>
      )}
      {status === "error" && error?.trim() && (
        <div className="home-ai-skill-revise-errdetail">{error.trim()}</div>
      )}
    </div>
  );
}

function AssistantPipelineBlock({
  pipeline,
  pipelineContext,
  onOptimizeStep,
}: {
  pipeline: AssistantPipeline;
  pipelineContext?: AssistantPipelineContextPersisted;
  onOptimizeStep?: (
    stepIndex: number,
    stepActionName: string,
    ctx?: AssistantPipelineContextPersisted,
  ) => void;
}) {
  return (
    <div className="home-ai-pipeline" role="region" aria-label="查询流水线">
      {pipeline.steps.map((step, idx) => (
        <div
          key={`${idx}-${step.actionName}`}
          className={`home-ai-pipeline-step home-ai-pipeline-step--${step.status}`}
        >
          <div className="home-ai-pipeline-cue">
            {step.status === "waiting" ? (
              <span className="home-ai-pipeline-wait">「{step.actionName}」等待前序步骤完成…</span>
            ) : (
              <>
                <span>我正在进行【{step.actionName}】</span>
                {step.status === "running" && <span className="home-ai-pipeline-spin" aria-hidden />}
                {step.status === "done" && (
                  <span className="home-ai-pipeline-check" aria-label="已完成">
                    ✅
                  </span>
                )}
                {step.status === "error" && (
                  <span className="home-ai-pipeline-err" aria-label="失败">
                    ✕
                  </span>
                )}
              </>
            )}
          </div>
          {step.resultFeedback && step.status !== "waiting" && (
            <>
              <div
                className={
                  step.actionName === "具体数据返回"
                    ? "home-ai-pipeline-result home-ai-pipeline-result--md"
                    : "home-ai-pipeline-result"
                }
              >
                {step.actionName === "具体数据返回" ? (
                  <ReactMarkdown>{step.resultFeedback}</ReactMarkdown>
                ) : (
                  step.resultFeedback
                )}
              </div>
              {step.status === "done" && onOptimizeStep && (
                <div className="home-ai-pipeline-optimize">
                  <button
                    type="button"
                    className="home-ai-pipeline-opt-btn"
                    onClick={() => onOptimizeStep(idx, step.actionName, pipelineContext)}
                  >
                    优化
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export function HomeAiChatPanel() {
  const { user, tasks } = useTasks();
  const optimizeTargetRef = useRef<{
    skillKey: import("../utils/aiChatSkillStore").AiChatSkillKey;
    stepLabel: string;
    stepActionName: string;
  } | null>(null);
  const [optimizeBanner, setOptimizeBanner] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const loaded = loadStoredChatMessages();
    if (loaded?.length) return normalizeStoredMessages(loaded);
    return [{ role: "assistant", text: buildAssistantWelcome("") }];
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [assistantUiMode, setAssistantUiMode] = useState<"user" | "debug">(() => {
    try {
      const v = localStorage.getItem(ASSISTANT_UI_MODE_KEY);
      if (v === "user" || v === "debug") return v;
    } catch {
      /* ignore */
    }
    return "debug";
  });
  const [userModeLive, setUserModeLive] = useState<UserModeLiveState | null>(null);
  const [streamReveal, setStreamReveal] = useState<{ full: string; shown: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** 上一轮操作路径已提示「请提供日报原文」，下一轮用户发送视为日报正文 */
  const awaitingReportBodyFromChatRef = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(ASSISTANT_UI_MODE_KEY, assistantUiMode);
    } catch {
      /* ignore */
    }
  }, [assistantUiMode]);

  const handleOptimizeStep = useCallback(
    (stepIndex: number, stepActionName: string, ctx?: AssistantPipelineContextPersisted) => {
      const mapped =
        ctx?.pipelineKind === "operation"
          ? skillKeyForOperationPipelineStep(stepIndex)
          : skillKeyForPipelineStep(stepIndex, ctx?.isReport ?? false);
      if (!mapped) return;
      optimizeTargetRef.current = {
        skillKey: mapped.key,
        stepLabel: mapped.label,
        stepActionName,
      };
      setOptimizeBanner(`请反馈【${stepActionName}】的修改意见`);
    },
    [],
  );

  const cancelOptimize = useCallback(() => {
    optimizeTargetRef.current = null;
    setOptimizeBanner(null);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, busy, userModeLive, streamReveal]);

  useEffect(() => {
    saveStoredChatMessages(messages);
  }, [messages]);

  useEffect(() => {
    setMessages((m) => {
      if (m.length !== 1) return m;
      const x = m[0];
      if (x.role !== "assistant" || "pipeline" in x || "skillRevise" in x) return m;
      if (!("text" in x) || !x.text.includes("欢迎使用齐峰新材重点任务管理系统")) return m;
      return [{ role: "assistant", text: buildAssistantWelcome(user.perspective) }];
    });
  }, [user.perspective]);

  useEffect(() => {
    const onParseResult = (ev: Event) => {
      const d = (ev as CustomEvent<AssistantReportParseResultDetail>).detail;
      if (!d) return;
      if (d.ok) {
        const bodyText = d.summaryLine
          ? d.summaryLine
          : [
              "**环节 1：解析原文**已完成（已由助手按《核心记忆》自动触发，等同点击「解析」）。",
              "",
              `- **提取日期**：${d.extractionDate || "—"}`,
              `- **分公司名称**：${d.companyName || "—"}`,
              "",
              "结构化结果已载入 **报告管理 → 报告提取 → 报告内容提取** 预览区。",
              ...(d.willChainCoreMemory
                ? [
                    "",
                    "系统将**自动顺序执行**《核心记忆》**环节 2：更新现有任务进度**与**环节 3：拆解日报计划为任务表**（不会自动写入任务列表；需在报告提取侧栏补充领导指示后点击「生成任务」）；全部完成后会再推送一条执行摘要。",
                  ]
                : []),
            ].join("\n");
        setMessages((m) => [...m, { role: "assistant", text: bodyText }]);
      } else {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text: `**自动解析未完成**：${d.error || "未知错误"}\n\n可检查大模型配置后重试，或在报告管理手动点击「解析」。`,
          },
        ]);
      }
    };
    window.addEventListener(ASSISTANT_REPORT_PARSE_RESULT_EVENT, onParseResult);
    return () => window.removeEventListener(ASSISTANT_REPORT_PARSE_RESULT_EVENT, onParseResult);
  }, []);

  useEffect(() => {
    const skipLabel = (code: string | null) => {
      if (!code) return "";
      const map: Record<string, string> = {
        no_env: "未配置大模型",
        no_slices: "无分公司日报切片或当前视角下无待更新的未完成任务",
        no_contexts: "未解析到可拆解的日报计划摘录",
        phase: "报告未处于可生成状态",
      };
      return map[code] ?? code;
    };
    const onChainDone = (ev: Event) => {
      const d = (ev as CustomEvent<AssistantReportChainDoneDetail>).detail;
      if (!d) return;
      if (d.chainError) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text: `**自动串联环节 2/3 异常**：${d.chainError}\n\n可在报告管理 **报告提取** 区手动点击「更新现有任务进度」「拆解日报计划条目」或「生成任务」重试。`,
          },
        ]);
        return;
      }
      const p2 =
        d.progressUpdated > 0
          ? `已根据日报更新 **${d.progressUpdated}** 条任务的进展时间线（及状态/指示等推断结果，以任务详情为准）。`
          : d.progressSkipped
            ? `环节 2 已跳过（${skipLabel(d.progressSkipped)}）。`
            : "环节 2 未写入新的任务进展。";
      const p3 =
        d.planGenerated > 0
          ? `已按日报计划 **生成 ${d.planGenerated} 条**新任务草稿（已写入任务列表，编号以界面为准）。`
          : d.planSkipped
            ? `环节 3 已跳过（${skipLabel(d.planSkipped)}）。`
            : "环节 3：已 **拆解日报计划为任务表**（未自动写入任务列表）。请在 **报告提取** 侧栏「日报计划任务生成」中补充「领导指示/建议」后，点击该卡片标题栏右侧 **「生成任务」**。";
      const bodyText = [
        "**环节 2、3 已按《核心记忆》自动顺序执行完毕**（无需等待您点击对应按钮）。",
        "",
        `- ${p2}`,
        `- ${p3}`,
        "",
        "详细卡片与错误行见 **报告管理 → 报告提取** 下方侧栏；任务明细见 **任务管理**。",
      ].join("\n");
      setMessages((m) => [...m, { role: "assistant", text: bodyText }]);
    };
    window.addEventListener(ASSISTANT_REPORT_CHAIN_DONE_EVENT, onChainDone);
    return () => window.removeEventListener(ASSISTANT_REPORT_CHAIN_DONE_EVENT, onChainDone);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;

    if (awaitingReportBodyFromChatRef.current && !optimizeTargetRef.current) {
      setInput("");
      setMessages((m) => [...m, { role: "user", text }]);
      setBusy(true);
      try {
        dispatchAssistantSetReportManualText(text);
        dispatchAssistantReportParse({
          sourceText: text,
          assistantChatFollowup: true,
          chainCoreMemorySteps: true,
        });
        awaitingReportBodyFromChatRef.current = false;
        const reply =
          "已根据《核心记忆》将您发送的内容写入**报告管理 → 报告提取 → 日报正文**，并已**自动执行环节 1：解析原文**。随后将**自动顺序执行环节 2（更新现有任务进度）与环节 3（拆解日报计划为任务表）**；环节 3 不会自动写入任务，请在侧栏补充领导指示后点击「生成任务」。各环节摘要将依次显示在本对话中。";
        if (assistantUiMode === "user") {
          setUserModeLive(null);
          setStreamReveal({ full: reply, shown: "" });
          let revealIdx = 0;
          while (revealIdx < reply.length) {
            revealIdx = nextRevealEnd(reply, revealIdx);
            setStreamReveal({ full: reply, shown: reply.slice(0, revealIdx) });
            await sleepMs(12);
          }
          setMessages((m) => [...m, { role: "assistant", text: reply }]);
          setStreamReveal(null);
        } else {
          setMessages((m) => [...m, { role: "assistant", text: reply }]);
        }
        try {
          appendAssistantHistoryTurn({
            userText: text,
            topicLabel: "报告管理·操作",
            topicKeywords: "日报正文·聊天区录入",
            scopeDescription: "operation_info.daily_report_body",
            recordIdsSummary: `正文约 ${text.length} 字`,
            answerSummary: reply,
          });
        } catch {
          /* ignore */
        }
      } finally {
        setBusy(false);
        setUserModeLive(null);
        setStreamReveal(null);
      }
      return;
    }

    const opt = optimizeTargetRef.current;
    if (opt) {
      const { skillKey, stepLabel, stepActionName } = opt;
      optimizeTargetRef.current = null;
      setOptimizeBanner(null);
      setInput("");
      const env = readLlmEnv();
      if (!env) {
        setMessages((m) => [
          ...m,
          { role: "user", text },
          {
            role: "assistant",
            text: "未配置大模型，无法根据修改意见修订提示词。请先在「系统配置」中填写 Key。",
          },
        ]);
        return;
      }
      setBusy(true);
      setMessages((m) => [
        ...m,
        { role: "user", text },
        {
          role: "assistant",
          skillRevise: {
            stepActionName,
            stepLabel,
            status: "running",
          },
        },
      ]);
      try {
        const r = await reviseSkillPromptWithFeedback(env, {
          skillKey,
          stepLabel,
          userFeedback: text,
        });
        setMessages((m) => {
          const next = [...m];
          let patched = false;
          for (let i = next.length - 1; i >= 0; i--) {
            const msg = next[i];
            if (
              msg.role === "assistant" &&
              "skillRevise" in msg &&
              msg.skillRevise.status === "running" &&
              msg.skillRevise.stepActionName === stepActionName
            ) {
              next[i] = {
                role: "assistant",
                skillRevise: {
                  stepActionName,
                  stepLabel,
                  status: r.ok ? "done" : "error",
                  changeSummary: r.ok ? r.changeSummary : undefined,
                  error: r.ok ? undefined : r.error,
                },
              };
              patched = true;
              break;
            }
          }
          if (patched) return next;
          return [
            ...next,
            {
              role: "assistant" as const,
              text: r.ok
                ? `已根据你的意见更新环节「${stepActionName}」对应的提示词（已写入本地 ai_chat_skill，可导出备份）。\n\n**主要修改**：${r.changeSummary}`
                : `提示词修订未成功：${r.error}`,
            },
          ];
        });
      } finally {
        setBusy(false);
      }
      return;
    }

    if (assistantUiMode === "user") {
      setInput("");
      setMessages((m) => [...m, { role: "user", text }]);
      setBusy(true);
      setUserModeLive(null);
      const runStage: UserModeStreamStage = async (stageLabel, streamFn) => {
        setUserModeLive({ stageLabel, lines: ["", "", ""], phase: "streaming" });
        const r = await streamFn((acc) => {
          setUserModeLive((prev) =>
            prev && prev.stageLabel === stageLabel && prev.phase === "streaming"
              ? { ...prev, lines: rollingThreeSubtitleLines(acc) }
              : prev,
          );
        });
        setUserModeLive((prev) =>
          prev && prev.stageLabel === stageLabel ? { ...prev, phase: "done" } : prev,
        );
        await sleepMs(480);
        setUserModeLive(null);
        return r;
      };
      try {
        const env = readLlmEnv();
        if (!env) {
          setMessages((m) => [
            ...m,
            {
              role: "assistant",
              text: "未配置大模型，请先在右上角「系统配置」中填写 Key 后重试。",
            },
          ]);
          return;
        }
        const ures = await runHomeAiUserModePipeline(text, env, tasks, user.perspective, runStage, {
          onFinalAnswerLoading: () =>
            setUserModeLive({
              stageLabel: "数据查询中",
              lines: ["", "", ""],
              phase: "final-waiting",
            }),
        });
        if (!ures.ok) {
          setMessages((m) => [...m, { role: "assistant", text: `执行异常：${ures.error}` }]);
          try {
            appendAssistantHistoryTurn({
              userText: text,
              topicLabel: "执行异常",
              topicKeywords: "用户模式流水线",
              scopeDescription: "—",
              recordIdsSummary: "—",
              answerSummary: ures.error,
            });
          } catch {
            /* ignore */
          }
          return;
        }
        const d = ures.data;
        if (d.kind === "operation" && d.awaitingReportBody) {
          awaitingReportBodyFromChatRef.current = true;
        }
        if (d.kind === "operation") {
          try {
            appendAssistantHistoryTurn({
              userText: text,
              topicLabel: `${topicChineseLabel(d.router.topic)}·操作`,
              topicKeywords: d.router.topic_rationale,
              scopeDescription: d.confirmSummary,
              recordIdsSummary: d.actionTokensLine,
              answerSummary: d.answer,
            });
          } catch {
            /* ignore */
          }
        } else if (d.kind === "report") {
          try {
            appendAssistantHistoryTurn({
              userText: text,
              topicLabel: topicChineseLabel(d.router.topic),
              topicKeywords: d.router.topic_rationale,
              scopeDescription: d.scopeDescription,
              recordIdsSummary: d.idLine,
              answerSummary: `${d.recordSummary}｜${d.answer}`,
            });
          } catch {
            /* ignore */
          }
        } else {
          try {
            appendAssistantHistoryTurn({
              userText: text,
              topicLabel: topicChineseLabel(d.router.topic),
              topicKeywords: d.router.topic_rationale,
              scopeDescription: d.scopeDescription,
              recordIdsSummary: d.idLine,
              answerSummary: d.answer,
            });
          } catch {
            /* ignore */
          }
        }
        const answerText = d.answer;
        setUserModeLive(null);
        setStreamReveal({ full: answerText, shown: "" });
        let revealIdx = 0;
        while (revealIdx < answerText.length) {
          revealIdx = nextRevealEnd(answerText, revealIdx);
          setStreamReveal({ full: answerText, shown: answerText.slice(0, revealIdx) });
          await sleepMs(12);
        }
        setMessages((m) => [...m, { role: "assistant", text: answerText }]);
        setStreamReveal(null);
      } finally {
        setBusy(false);
        setUserModeLive(null);
        setStreamReveal(null);
      }
      return;
    }

    setInput("");
    setMessages((m) => [...m, { role: "user", text }, { role: "assistant", pipeline: createInitialPipeline() }]);
    setBusy(true);

    const runOffline = (offlineRouter: TopicRouterResult) => {
      if (offlineRouter.interaction_mode === "operation") {
        setMessages((m) =>
          patchLastPipeline(m, () => ({
            steps: [
              {
                actionName: "意图判断",
                status: "done",
                resultFeedback: `离线判定：操作 · ${topicChineseLabel(offlineRouter.topic)}`,
              },
              {
                actionName: "确认操作及范围",
                status: "done",
                resultFeedback: "当前未连接大模型，无法自动确认操作细节。",
              },
              {
                actionName: "行操作执行",
                status: "done",
                resultFeedback:
                  "当前未连接大模型，无法解析界面动作。请在「系统配置」填写模型 Key 后重试。",
              },
            ],
          })),
        );
        return;
      }
      setMessages((m) =>
        patchLastPipeline(m, () => ({
          steps: [
            {
              actionName: "主题判断",
              status: "done",
              resultFeedback: `已经确认查询主题：${topicChineseLabel(offlineRouter.topic)}（离线规则，非大模型）`,
            },
            {
              actionName: "数据范围判断",
              status: "done",
              resultFeedback: "当前未连接大模型，无法自动完成数据范围判断。",
            },
            {
              actionName: "数据记录判断",
              status: "done",
              resultFeedback: "当前未连接大模型，无法自动匹配任务编号与提取历史 id。",
            },
            {
              actionName: "具体数据返回",
              status: "done",
              resultFeedback:
                "请在右上角「系统配置」填写 DeepSeek Key（或配置构建环境变量 `VITE_LLM_*`）后重试。",
            },
          ],
        })),
      );
    };

    try {
      const env = readLlmEnv();
      if (!env) {
        const offlineRouter: TopicRouterResult = {
          interaction_mode: inferOfflineInteractionMode(text),
          topic: inferOfflineTopic(text),
          topic_rationale: inferOfflineIntentSummary(text),
        };
        runOffline(offlineRouter);
        try {
          appendAssistantHistoryTurn({
            userText: text,
            topicLabel: topicChineseLabel(offlineRouter.topic),
            topicKeywords: offlineRouter.topic_rationale,
            scopeDescription: "离线未连接大模型，无数据范围判定",
            recordIdsSummary: "—",
            answerSummary: "未完成查询，请配置模型 Key 后重试",
          });
        } catch {
          /* 历史写入失败不影响主流程 */
        }
        setMessages((m) =>
          patchLastPipelineWithContext(m, {
            isReport: offlineRouter.topic === "report_management",
            pipelineKind: offlineRouter.interaction_mode === "operation" ? "operation" : "inquiry",
          }),
        );
        return;
      }

      // —— ① 主题判断 ——
      const routerRes = await callLlmChatJsonObject(
        env,
        buildTopicRouterSystemPrompt(),
        buildTopicRouterUserPayload(text),
        1024,
      );
      const routerParsed = parseTopicRouterJson(routerRes.content);
      let router: TopicRouterResult = routerParsed ?? ROUTER_FALLBACK;
      router = applyInquiryTopicHistoryFallback(router, text);
      router = coerceOperationModeForReportIntake(router, text);
      router = coerceOperationModeForTaskManualNew(router, text);
      const topicBlock = formatTopicBlock(router);

      if (router.interaction_mode === "operation") {
        const operationPipelineCtx: AssistantPipelineContextPersisted = { pipelineKind: "operation" };
        const intentStepFeedback = appendDebugModelRawReturn(
          `解析摘要：交互类型「操作」；主题「${topicChineseLabel(router.topic)}」\n判定说明：${router.topic_rationale}`,
          routerRes.content,
        );
        setMessages((m) => {
          const pipelined = patchLastPipeline(m, () => ({
            steps: [
              { actionName: "意图判断", status: "done", resultFeedback: intentStepFeedback },
              { actionName: "确认操作及范围", status: "running" },
              { actionName: "行操作执行", status: "waiting" },
            ],
          }));
          return patchLastPipelineWithContext(pipelined, operationPipelineCtx);
        });

        const confirmRes = await callLlmChatJsonObject(
          env,
          buildOperationConfirmSystemPrompt(),
          buildOperationConfirmUserPayload(text, topicBlock),
          2048,
        );
        let confirm =
          parseOperationConfirmJson(confirmRes.content) ??
          ({
            module: router.topic,
            operation: "（未解析）",
            operation_info: {},
            user_facing_summary: "未能解析操作确认结果。",
          } as const);
        confirm = normalizeReportIntakeConfirm(confirm, text);
        const confirmSummary = [
          `模块：${topicChineseLabel(confirm.module)}`,
          `操作：${confirm.operation}`,
          `摘要：${confirm.user_facing_summary}`,
          `operation_info：${JSON.stringify(confirm.operation_info)}`,
        ].join("\n");
        const confirmStepFeedback = appendDebugModelRawReturn(confirmSummary, confirmRes.content);

        setMessages((m) =>
          patchLastPipeline(m, (p) => ({
            steps: p.steps.map((s, i) => {
              if (i === 1)
                return { ...s, status: "done" as const, resultFeedback: confirmStepFeedback };
              if (i === 2) return { ...s, status: "running" as const };
              return s;
            }),
          })),
        );

        if (shouldAwaitDailyReportBodyInChat(confirm)) {
          dispatchAssistantUiActions([{ kind: "focus_report_extraction" }]);
          awaitingReportBodyFromChatRef.current = true;
          const execSummary =
            "未调用行操作模型：按《核心记忆》需先在聊天区收集日报正文；已派发 focus_report_extraction。下一行请在助手输入框发送完整日报原文；发送后将**自动解析**并在本对话展示摘要。";
          const execStepFeedback = appendDebugModelRawReturn(execSummary, "（无模型输出 — 等待聊天区日报正文）");
          setMessages((m) =>
            patchLastPipeline(m, (p) => ({
              steps: p.steps.map((s, i) => {
                if (i === 2)
                  return { ...s, status: "done" as const, resultFeedback: execStepFeedback };
                return s;
              }),
            })),
          );
          try {
            appendAssistantHistoryTurn({
              userText: text,
              topicLabel: `${topicChineseLabel(router.topic)}·操作`,
              topicKeywords: router.topic_rationale,
              scopeDescription: `${confirm.operation}｜${confirm.user_facing_summary}`,
              recordIdsSummary: "等待聊天区日报正文",
              answerSummary: execSummary,
            });
          } catch {
            /* ignore */
          }
          setMessages((m) => patchLastPipelineWithContext(m, operationPipelineCtx));
          return;
        }

        const pastedBody = getDailyReportBodyFromOperationInfo(confirm.operation_info);
        if (pastedBody.length >= DAILY_REPORT_BODY_MIN_LEN) {
          dispatchAssistantSetReportManualText(pastedBody);
        }

        const confirmJson = JSON.stringify(confirm, null, 2);
        const execRes = await callLlmChatJsonObject(
          env,
          buildOperationExecuteSystemPrompt(),
          buildOperationExecuteUserPayload(text, topicBlock, confirmJson),
          1024,
        );
        const execParsed = parseOperationExecuteJson(execRes.content);
        const tokens = runAssistantOperationUiActions(execRes.content.trim());
        const execSummary = [
          execParsed?.rationale ?? "（无 rationale）",
          tokens.length ? `ui_action_tokens：${tokens.join(" → ")}` : "（未触发界面动作）",
        ].join("\n");
        const execStepFeedback = appendDebugModelRawReturn(execSummary, execRes.content);

        setMessages((m) =>
          patchLastPipeline(m, (p) => ({
            steps: p.steps.map((s, i) => {
              if (i === 2)
                return { ...s, status: "done" as const, resultFeedback: execStepFeedback };
              return s;
            }),
          })),
        );

        try {
          appendAssistantHistoryTurn({
            userText: text,
            topicLabel: `${topicChineseLabel(router.topic)}·操作`,
            topicKeywords: router.topic_rationale,
            scopeDescription: `${confirm.operation}｜${confirm.user_facing_summary}`,
            recordIdsSummary: tokens.length ? tokens.join("、") : "—",
            answerSummary: execSummary,
          });
        } catch {
          /* ignore */
        }
        setMessages((m) => patchLastPipelineWithContext(m, operationPipelineCtx));
        return;
      }

      setMessages((m) =>
        patchLastPipeline(m, (p) => ({
          steps: p.steps.map((s, i) => {
            if (i === 0)
              return {
                ...s,
                status: "done" as const,
                resultFeedback: `已经确认：询问 · ${topicChineseLabel(router.topic)}`,
              };
            if (i === 1) return { ...s, status: "running" as const };
            return s;
          }),
        })),
      );

      const isReport = router.topic === "report_management";
      let reportScope: ReportDataScopeResult = {
        scope_summary: "",
        report_dates: [],
        branch_companies: [],
      };
      /** 报告流水线：与数据范围对齐后的可见提取历史（避免第 2、3 步重复加载） */
      let reportPipelineVis: ReturnType<typeof loadExtractionHistory> = [];
      let reportPipelineContextNote = "";
      let reportDateStalemate = false;

      // —— ② 数据范围判断 ——
      let scopeDescription: string;
      let taskDataRecordScopeDescriptionForLlm = "";
      let taskBranchScopeBaseline: DataScopeBaselineIds | null = null;
      if (isReport) {
        const allHist = loadExtractionHistory();
        reportPipelineVis = allHist.filter((h) => extractionHistoryVisibleForPerspective(h, user.perspective));
        if (reportPipelineVis.length === 0 && allHist.length > 0) {
          reportPipelineVis = allHist;
          reportPipelineContextNote = `【系统说明】当前视角下按规则未匹配到任何提取历史（常见于记录内「分公司名称」为空或与视角不一致）。已临时使用**全部本地提取历史**共 ${allHist.length} 条供检索；结论请以「报告管理」界面为准。`;
        }
        const scopeRes = await callLlmChatJsonObject(
          env,
          buildDataScopeSystemPromptForReport(),
          buildDataScopeUserPayload(text, topicBlock),
          1024,
        );
        reportScope = parseDataScopeReportJson(scopeRes.content) ?? reportScope;
        const inferredDates = inferIsoDatesFromChineseQuestion(text);
        if (inferredDates.length) {
          reportScope = {
            ...reportScope,
            report_dates: [...new Set([...reportScope.report_dates, ...inferredDates])],
          };
        }
        const dateResolved = resolveReportDatesAgainstVisibleHistory(
          text,
          reportScope.report_dates,
          reportPipelineVis,
        );
        reportScope = { ...reportScope, report_dates: dateResolved.report_dates };
        reportDateStalemate = dateResolved.stalemateNoExtractDate;
        scopeDescription = formatReportDataScopeFeedback(reportScope, {
          stalemateNoExtractDate: reportDateStalemate,
        });
      } else {
        const scopeRes = await callLlmChatJsonObject(
          env,
          buildDataScopeSystemPrompt(),
          buildDataScopeUserPayload(text, topicBlock),
          1024,
        );
        const scopeParsed = parseDataScopeJson(scopeRes.content);
        const scopeDescriptionCore =
          scopeParsed?.scope_description ?? "（模型未返回可解析的数据范围，将按空范围继续。）";
        const scopeBaseline =
          scopeParsed &&
          (scopeParsed.baseline_task_codes?.length || scopeParsed.baseline_extraction_history_ids?.length)
            ? {
                task_codes: scopeParsed.baseline_task_codes ?? [],
                extraction_history_ids: scopeParsed.baseline_extraction_history_ids ?? [],
              }
            : null;
        taskDataRecordScopeDescriptionForLlm = scopeDescriptionCore;
        taskBranchScopeBaseline = scopeBaseline;
        scopeDescription = scopeDescriptionCore;
        if (scopeBaseline) {
          scopeDescription = `${scopeDescriptionCore}\n记录标识基线（优先于下一步匹配）：任务 ${
            scopeBaseline.task_codes.length ? scopeBaseline.task_codes.join("、") : "—"
          }；提取历史 ${
            scopeBaseline.extraction_history_ids.length ? scopeBaseline.extraction_history_ids.join("、") : "—"
          }`;
        }
      }

      setMessages((m) =>
        patchLastPipeline(m, (p) => ({
          steps: p.steps.map((s, i) => {
            if (i === 1)
              return {
                ...s,
                status: "done" as const,
                resultFeedback: isReport ? scopeDescription : `已明确数据范围：${scopeDescription}`,
              };
            if (i === 2) return { ...s, status: "running" as const };
            return s;
          }),
        })),
      );

      if (isReport) {
        // —— ③ 报告 · 数据记录判断（结构化 JSON + 形态说明 → 答复）——
        const vis = reportPipelineVis;
        const reportContextNote = reportPipelineContextNote;
        const picked = reportDateStalemate
          ? []
          : filterExtractionHistoryByReportScope(
              vis,
              reportScope.report_dates,
              reportScope.branch_companies,
              8,
            );
        const structured = buildReportStructuredArrayForLlm(picked);
        const stalemateNote = reportDateStalemate
          ? "【系统说明】本机可见提取历史中没有任何一条的「提取日期」与您问题中的日期相符，故未向模型传入报告 JSON。"
          : "";
        const rr = await callLlmChatJsonObject(
          env,
          buildReportDataRecordSystemPrompt(),
          buildReportDataRecordUserPayload(
            text,
            REPORT_PRODUCTION_STRUCTURE_DOC,
            structured,
            [reportContextNote, stalemateNote].filter(Boolean).join("\n\n") || undefined,
          ),
          8192,
        );
        const judged = parseReportDataRecordJudgmentJson(rr.content);
        const rawReportAns = judged?.answer ?? rr.content.trim().slice(0, 12000);
        const answerFromReport = rawReportAns || "（空回复）";
        const step3Feedback = [
          "已经确定数据记录集",
          judged?.record_set_summary ?? `共匹配 ${picked.length} 条提取记录（当前视角内）。`,
        ].join("\n");

        setMessages((m) =>
          patchLastPipeline(m, (p) => ({
            steps: p.steps.map((s, i) => {
              if (i === 2)
                return {
                  ...s,
                  status: "done" as const,
                  resultFeedback: step3Feedback,
                };
              if (i === 3) return { ...s, status: "running" as const };
              return s;
            }),
          })),
        );

        setMessages((m) =>
          patchLastPipeline(m, (p) => ({
            steps: p.steps.map((s, i) => {
              if (i === 3)
                return {
                  ...s,
                  status: "done" as const,
                  resultFeedback: answerFromReport,
                };
              return s;
            }),
          })),
        );

        try {
          const idLine =
            picked.length > 0
              ? picked.map((h) => h.id).join("、")
              : reportDateStalemate
                ? "日期僵局·无记录入模"
                : "无匹配提取记录";
          appendAssistantHistoryTurn({
            userText: text,
            topicLabel: topicChineseLabel(router.topic),
            topicKeywords: router.topic_rationale,
            scopeDescription,
            recordIdsSummary: idLine,
            answerSummary: judged?.record_set_summary
              ? `${judged.record_set_summary}｜${answerFromReport}`
              : answerFromReport,
          });
        } catch {
          /* ignore */
        }
      } else {
        // —— ③ 任务/综合 · 数据记录判断（动态记忆 id）——
        const recordRes = await callLlmChatJsonObject(
          env,
          buildDataRecordSystemPrompt(),
          buildDataRecordUserPayload(
            text,
            topicBlock,
            taskDataRecordScopeDescriptionForLlm,
            taskBranchScopeBaseline,
          ),
          2048,
        );
        const recordParsed = parseDataRecordJson(recordRes.content);
        const taskCodes = recordParsed?.task_codes ?? [];
        const historyIds = recordParsed?.extraction_history_ids ?? [];
        const recordNote = recordParsed?.rationale ?? "";

        const historyAll = loadExtractionHistory();
        const pickedTasks = pickTasksByCodes(tasks, taskCodes);
        const pickedHistory = pickHistoryByIds(historyAll, historyIds);
        const rows = [...tasksToLlmRows(pickedTasks), ...extractionItemsToLlmRows(pickedHistory)];
        const rowsJson = JSON.stringify(
          { rows, meta: { task_row_count: pickedTasks.length, report_row_count: pickedHistory.length } },
          null,
          2,
        );

        const idSummary = [
          pickedTasks.length ? `任务编号：${pickedTasks.map((t) => t.code).join("、")}` : null,
          pickedHistory.length ? `提取历史 id：${pickedHistory.map((h) => h.id).join("、")}` : null,
        ]
          .filter(Boolean)
          .join("\n");

        setMessages((m) =>
          patchLastPipeline(m, (p) => ({
            steps: p.steps.map((s, i) => {
              if (i === 2)
                return {
                  ...s,
                  status: "done" as const,
                  resultFeedback: [
                    "已经确定数据记录集",
                    idSummary || "（未匹配到本机任务或提取历史行，第 4 步将按空集回答。）",
                    recordNote ? `说明：${recordNote}` : "",
                  ]
                    .filter(Boolean)
                    .join("\n"),
                };
              if (i === 3) return { ...s, status: "running" as const };
              return s;
            }),
          })),
        );

        // —— ④ 具体数据返回 ——
        const finalRes = await callLlmChatJsonObject(
          env,
          buildFinalDataAnswerSystemPrompt(),
          buildFinalDataAnswerUserPayload(text, rowsJson),
          4096,
        );
        const rawAnswer =
          parseFinalAnswerJson(finalRes.content) ?? finalRes.content.trim().slice(0, 12000);
        const answer = rawAnswer || "（空回复）";

        setMessages((m) =>
          patchLastPipeline(m, (p) => ({
            steps: p.steps.map((s, i) => {
              if (i === 3)
                return {
                  ...s,
                  status: "done" as const,
                  resultFeedback: answer,
                };
              return s;
            }),
          })),
        );

        try {
          const idLine =
            pickedTasks.length || pickedHistory.length
              ? [
                  pickedTasks.length && `任务:${pickedTasks.map((t) => t.code).join("、")}`,
                  pickedHistory.length && `提取:${pickedHistory.map((h) => h.id).join("、")}`,
                ]
                  .filter(Boolean)
                  .join("；")
              : "—";
          appendAssistantHistoryTurn({
            userText: text,
            topicLabel: topicChineseLabel(router.topic),
            topicKeywords: router.topic_rationale,
            scopeDescription: `已明确数据范围：${scopeDescription}`,
            recordIdsSummary: idLine,
            answerSummary: answer,
          });
        } catch {
          /* ignore */
        }
      }

      setMessages((m) =>
        patchLastPipelineWithContext(m, { isReport, pipelineKind: "inquiry" }),
      );
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      try {
        appendAssistantHistoryTurn({
          userText: text,
          topicLabel: "执行异常",
          topicKeywords: "流水线中断",
          scopeDescription: "—",
          recordIdsSummary: "—",
          answerSummary: err,
        });
      } catch {
        /* ignore */
      }
      setMessages((m) =>
        patchLastPipeline(m, (p) => {
          const steps = [...p.steps];
          const runIdx = steps.findIndex((s) => s.status === "running");
          const idx = runIdx >= 0 ? runIdx : steps.length - 1;
          return {
            steps: steps.map((s, i) => {
              if (i < idx) return s;
              if (i === idx)
                return {
                  ...s,
                  status: "error" as const,
                  resultFeedback: `该步骤失败：${err}`,
                };
              return { ...s, status: "waiting" as const, resultFeedback: undefined };
            }),
          };
        }),
      );
    } finally {
      setBusy(false);
    }
  }, [input, busy, tasks, user.perspective, assistantUiMode]);

  return (
    <div className="card home-ai-chat" aria-label="AI 问答">
      <div className="card-head tight home-ai-chat-head">
        <h3>AI 助手</h3>
        <div className="home-ai-mode-tabs" role="tablist" aria-label="助手显示模式">
          <button
            type="button"
            role="tab"
            aria-selected={assistantUiMode === "user"}
            className={`home-ai-mode-tab${assistantUiMode === "user" ? " is-active" : ""}`}
            onClick={() => setAssistantUiMode("user")}
          >
            用户模式
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={assistantUiMode === "debug"}
            className={`home-ai-mode-tab${assistantUiMode === "debug" ? " is-active" : ""}`}
            onClick={() => setAssistantUiMode("debug")}
          >
            调试模式
          </button>
        </div>
        <span className="muted tiny home-ai-chat-perspective">当前视角：{user.perspective || "—"}</span>
      </div>
      <div className="home-ai-chat-messages" ref={listRef} role="log" aria-live="polite">
        {messages.map((msg, i) => {
          if (msg.role === "user") {
            return (
              <div key={`${i}-user`} className="home-ai-chat-bubble home-ai-chat-bubble--user">
                {msg.text}
              </div>
            );
          }
          if ("pipeline" in msg) {
            return (
              <div key={`${i}-pipeline`} className="home-ai-chat-bubble home-ai-chat-bubble--assistant">
                <AssistantPipelineBlock
                  pipeline={msg.pipeline}
                  pipelineContext={msg.pipelineContext}
                  onOptimizeStep={handleOptimizeStep}
                />
              </div>
            );
          }
          if ("skillRevise" in msg) {
            return (
              <div key={`${i}-skill-revise`} className="home-ai-chat-bubble home-ai-chat-bubble--assistant">
                <SkillReviseBubbleLine skillRevise={msg.skillRevise} />
              </div>
            );
          }
          return (
            <div
              key={`${i}-assistant`}
              className="home-ai-chat-bubble home-ai-chat-bubble--assistant home-ai-chat-bubble--md"
            >
              <ReactMarkdown>{msg.text}</ReactMarkdown>
            </div>
          );
        })}
        {userModeLive && (
          <div className="home-ai-user-mode-stage-wrap">
            <div className="home-ai-user-mode-stage">
              <div className="home-ai-user-mode-stage-title">
                <span className="home-ai-user-mode-stage-title-text">{userModeLive.stageLabel}</span>
                {(userModeLive.phase === "streaming" || userModeLive.phase === "final-waiting") && (
                  <span className="home-ai-pipeline-spin home-ai-user-mode-title-spin" aria-hidden />
                )}
                {userModeLive.phase === "done" && (
                  <span className="home-ai-user-mode-check" aria-hidden>
                    ☑️
                  </span>
                )}
              </div>
              {userModeLive.phase !== "final-waiting" && (
                <div className="home-ai-user-mode-cues">
                  {userModeLive.lines.map((line, li) => (
                    <div key={li} className="home-ai-user-mode-cue-line">
                      {line || "\u00a0"}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {streamReveal && (
          <div className="home-ai-chat-bubble home-ai-chat-bubble--assistant home-ai-user-stream-reveal-wrap">
            <div className="home-ai-user-stream-reveal-inner">
              <span className="home-ai-user-stream-reveal-text">{streamReveal.shown}</span>
              <span className="home-ai-user-stream-reveal-cursor" aria-hidden>
                ▍
              </span>
            </div>
          </div>
        )}
      </div>
      <div className="home-ai-chat-input-row">
        {optimizeBanner && (
          <div className="home-ai-skill-optimize-banner" role="status">
            <span>{optimizeBanner}</span>
            <button type="button" className="linkish tiny" onClick={cancelOptimize}>
              取消
            </button>
          </div>
        )}
        <textarea
          className="home-ai-chat-textarea fld"
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            optimizeBanner
              ? "请输入对该环节提示词的修改意见，Enter 发送"
              : assistantUiMode === "user"
                ? "用户模式：Enter 发送；前三步流式字幕，数据查询完成后在聊天区逐字显示答复"
                : "调试模式：输入问题，Enter 发送；Shift+Enter 换行"
          }
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="button" className="primary-btn home-ai-chat-send" disabled={busy} onClick={() => void send()}>
          发送
        </button>
      </div>
    </div>
  );
}
