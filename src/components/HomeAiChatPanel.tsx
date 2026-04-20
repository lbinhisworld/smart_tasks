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
import { extractionHistoryVisibleForPerspective } from "../utils/leaderPerspective";
import {
  filterExtractionHistoryByReportScope,
  inferIsoDatesFromChineseQuestion,
  resolveReportDatesAgainstVisibleHistory,
} from "../utils/reportExtractionScopeFilter";

export type PipelineStepStatus = "waiting" | "running" | "done" | "error";

export type PipelineStep = {
  actionName: string;
  status: PipelineStepStatus;
  /** 结果反馈提示语（展示在动作行下方） */
  resultFeedback?: string;
};

export type AssistantPipeline = {
  steps: PipelineStep[];
};

type ChatMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | { role: "assistant"; pipeline: AssistantPipeline };

const ROUTER_FALLBACK: TopicRouterResult = {
  topic: "general",
  topic_rationale: "未能解析主题路由结果，已按「综合或其它」处理。",
};

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

function AssistantPipelineBlock({ pipeline }: { pipeline: AssistantPipeline }) {
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
          )}
        </div>
      ))}
    </div>
  );
}

export function HomeAiChatPanel() {
  const { user, tasks } = useTasks();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "你好，我是数据看板助手。每次提问将顺序执行四步：**主题判断** → **数据范围判断** → **数据记录判断** → **具体数据返回**；每步会先显示「我正在进行【动作名】」与加载动画，完成后变为 ✅ 并展示结果反馈。第 4 步结果支持 **Markdown** 渲染，小标题（## / ###）将以蓝色突出显示。请先配置大模型 Key。",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }, { role: "assistant", pipeline: createInitialPipeline() }]);
    setBusy(true);

    const runOffline = () => {
      const offlineRouter: TopicRouterResult = {
        topic: inferOfflineTopic(text),
        topic_rationale: inferOfflineIntentSummary(text),
      };
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
        runOffline();
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
      const router: TopicRouterResult = routerParsed ?? ROUTER_FALLBACK;
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
        scopeDescription =
          scopeParsed?.scope_description ?? "（模型未返回可解析的数据范围，将按空范围继续。）";
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
      } else {
        // —— ③ 任务/综合 · 数据记录判断（动态记忆 id）——
        const recordRes = await callLlmChatJsonObject(
          env,
          buildDataRecordSystemPrompt(),
          buildDataRecordUserPayload(text, topicBlock, scopeDescription),
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
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
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
  }, [input, busy, tasks, user.perspective]);

  return (
    <div className="card home-ai-chat" aria-label="AI 问答">
      <div className="card-head tight">
        <h3>AI 助手</h3>
        <span className="muted tiny">当前视角：{user.perspective || "—"}</span>
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
                <AssistantPipelineBlock pipeline={msg.pipeline} />
              </div>
            );
          }
          return (
            <div key={`${i}-assistant`} className="home-ai-chat-bubble home-ai-chat-bubble--assistant">
              {msg.text}
            </div>
          );
        })}
      </div>
      <div className="home-ai-chat-input-row">
        <textarea
          className="home-ai-chat-textarea fld"
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入问题，Enter 发送；Shift+Enter 换行"
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
