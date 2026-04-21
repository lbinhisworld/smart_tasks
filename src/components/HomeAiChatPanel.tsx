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
  buildDataRecordSystemPrompt,
  buildDataRecordUserPayload,
  buildDataScopeSystemPrompt,
  buildDataScopeSystemPromptForReport,
  buildDataScopeUserPayload,
  buildFinalDataAnswerSystemPrompt,
  buildFinalDataAnswerUserPayload,
  buildReportDataRecordSystemPrompt,
  buildReportDataRecordUserPayload,
  buildTopicRouterSystemPrompt,
  buildTopicRouterUserPayload,
  type DataScopeBaselineIds,
  formatReportDataScopeFeedback,
  formatTopicBlock,
  inferOfflineIntentSummary,
  inferOfflineTopic,
  parseDataRecordJson,
  parseDataScopeJson,
  parseDataScopeReportJson,
  parseFinalAnswerJson,
  parseReportDataRecordJudgmentJson,
  parseTopicRouterJson,
  topicChineseLabel,
  type ReportDataScopeResult,
  type TopicRouterResult,
} from "../utils/homeAssistantPrompt";
import { buildReportStructuredArrayForLlm } from "../utils/homeAssistantReportPayload";
import { callLlmChatJsonObject, readLlmEnv } from "../utils/llmExtract";
import { nextRevealEnd, rollingThreeSubtitleLines, sleepMs } from "../utils/userModeStreamDisplay";
import { extractionHistoryVisibleForPerspective } from "../utils/leaderPerspective";
import {
  appendAssistantHistoryTurn,
  getAssistantHistoryForRouter,
  inferTopicFromHistoryMarkdown,
  intentTopicSwitchedFromPrior,
} from "../utils/assistantHistoryMd";
import { skillKeyForPipelineStep } from "../utils/aiChatSkillStore";
import { reviseSkillPromptWithFeedback } from "../utils/aiChatSkillRevision";
import {
  loadStoredChatMessages,
  normalizeStoredMessages,
  saveStoredChatMessages,
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
  topic: "general",
  topic_rationale: "未能解析主题路由结果，已按「综合或其它」处理。",
};

function buildAssistantWelcome(perspective: string): string {
  const p = perspective.trim() || "用户";
  return `尊敬的【${p}】，欢迎使用齐峰新材重点任务管理系统。`;
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

function patchLastPipelineWithContext(messages: ChatMessage[], isReport: boolean): ChatMessage[] {
  const last = messages.length - 1;
  if (last < 0) return messages;
  const tail = messages[last];
  if (tail.role !== "assistant" || !("pipeline" in tail)) return messages;
  return [...messages.slice(0, last), { ...tail, pipelineContext: { isReport } }];
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
  pipelineContext?: { isReport: boolean };
  onOptimizeStep?: (stepIndex: number, stepActionName: string, ctx?: { isReport: boolean }) => void;
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

  useEffect(() => {
    try {
      localStorage.setItem(ASSISTANT_UI_MODE_KEY, assistantUiMode);
    } catch {
      /* ignore */
    }
  }, [assistantUiMode]);

  const handleOptimizeStep = useCallback(
    (stepIndex: number, stepActionName: string, ctx?: { isReport: boolean }) => {
      const isReport = ctx?.isReport ?? false;
      const mapped = skillKeyForPipelineStep(stepIndex, isReport);
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

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;

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
        if (d.kind === "report") {
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
        setMessages((m) => patchLastPipelineWithContext(m, offlineRouter.topic === "report_management"));
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
      if (router.topic === "general") {
        const inferred = inferTopicFromHistoryMarkdown(getAssistantHistoryForRouter());
        if (
          inferred &&
          (inferred === "report_management" || inferred === "task_management") &&
          !intentTopicSwitchedFromPrior(text, router.topic_rationale, inferred)
        ) {
          router = {
            topic: inferred,
            topic_rationale: `${router.topic_rationale}（多轮语境：根据 history.md 中近期主题线索延续为「${topicChineseLabel(inferred)}」。）`,
          };
        }
      }
      const topicBlock = formatTopicBlock(router);

      setMessages((m) =>
        patchLastPipeline(m, (p) => ({
          steps: p.steps.map((s, i) => {
            if (i === 0)
              return {
                ...s,
                status: "done" as const,
                resultFeedback: `已经确认查询主题：${topicChineseLabel(router.topic)}`,
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

      setMessages((m) => patchLastPipelineWithContext(m, isReport));
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
