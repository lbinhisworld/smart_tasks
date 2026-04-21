/**
 * @fileoverview AI 助手「用户模式」：前三环节流式调用 + 末环节非流式，供 HomeAiChatPanel 使用。
 */

import { REPORT_PRODUCTION_STRUCTURE_DOC } from "../constants/reportProductionStructuredSchemaDoc";
import type { Task } from "../types/task";
import { loadExtractionHistory } from "./extractionHistoryStorage";
import {
  extractionItemsToLlmRows,
  pickHistoryByIds,
  pickTasksByCodes,
  tasksToLlmRows,
} from "./homeAssistantDataRows";
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
  parseDataRecordJson,
  parseDataScopeJson,
  parseDataScopeReportJson,
  parseFinalAnswerJson,
  parseReportDataRecordJudgmentJson,
  parseTopicRouterJson,
  topicChineseLabel,
  type ReportDataScopeResult,
  type TopicRouterResult,
} from "./homeAssistantPrompt";
import { buildReportStructuredArrayForLlm } from "./homeAssistantReportPayload";
import {
  getAssistantHistoryForRouter,
  inferTopicFromHistoryMarkdown,
  intentTopicSwitchedFromPrior,
} from "./assistantHistoryMd";
import {
  callLlmChatJsonObject,
  callLlmChatJsonObjectStreaming,
  type LlmEnv,
  type ProductionReportExtractionResult,
} from "./llmExtract";
import { extractionHistoryVisibleForPerspective } from "./leaderPerspective";
import {
  filterExtractionHistoryByReportScope,
  inferIsoDatesFromChineseQuestion,
  resolveReportDatesAgainstVisibleHistory,
} from "./reportExtractionScopeFilter";

const ROUTER_FALLBACK: TopicRouterResult = {
  topic: "general",
  topic_rationale: "未能解析主题路由结果，已按「综合或其它」处理。",
};

export type UserModeStreamStage = (
  label: string,
  streamFn: (onDelta: (acc: string) => void) => Promise<ProductionReportExtractionResult>,
) => Promise<ProductionReportExtractionResult>;

export type UserModePipelineCallbacks = {
  /** 进入最终数据返回（任务路径：调用最终 LLM 前；报告路径：数据记录流式完成后、解析前） */
  onFinalAnswerLoading?: () => void;
};

export type UserModePipelineOk =
  | {
      kind: "report";
      answer: string;
      router: TopicRouterResult;
      scopeDescription: string;
      idLine: string;
      recordSummary: string;
    }
  | {
      kind: "task";
      answer: string;
      router: TopicRouterResult;
      scopeDescription: string;
      idLine: string;
    };

export async function runHomeAiUserModePipeline(
  text: string,
  env: LlmEnv,
  tasks: Task[],
  userPerspective: string,
  runStage: UserModeStreamStage,
  callbacks?: UserModePipelineCallbacks,
): Promise<{ ok: true; data: UserModePipelineOk } | { ok: false; error: string }> {
  try {
    const routerRes = await runStage("主题判断", (onDelta) =>
      callLlmChatJsonObjectStreaming(
        env,
        buildTopicRouterSystemPrompt(),
        buildTopicRouterUserPayload(text),
        1024,
        onDelta,
      ),
    );
    let router: TopicRouterResult = parseTopicRouterJson(routerRes.content) ?? ROUTER_FALLBACK;
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
    const isReport = router.topic === "report_management";

    let reportScope: ReportDataScopeResult = {
      scope_summary: "",
      report_dates: [],
      branch_companies: [],
    };
    let reportPipelineVis = loadExtractionHistory().filter((h) =>
      extractionHistoryVisibleForPerspective(h, userPerspective),
    );
    let reportPipelineContextNote = "";
    let reportDateStalemate = false;

    let scopeDescription: string;
    let taskDataRecordScopeDescriptionForLlm = "";
    let taskBranchScopeBaseline: DataScopeBaselineIds | null = null;

    if (isReport) {
      const allHist = loadExtractionHistory();
      reportPipelineVis = allHist.filter((h) => extractionHistoryVisibleForPerspective(h, userPerspective));
      if (reportPipelineVis.length === 0 && allHist.length > 0) {
        reportPipelineVis = allHist;
        reportPipelineContextNote = `【系统说明】当前视角下按规则未匹配到任何提取历史（常见于记录内「分公司名称」为空或与视角不一致）。已临时使用**全部本地提取历史**共 ${allHist.length} 条供检索；结论请以「报告管理」界面为准。`;
      }
      const scopeRes = await runStage("数据范围判断", (onDelta) =>
        callLlmChatJsonObjectStreaming(
          env,
          buildDataScopeSystemPromptForReport(),
          buildDataScopeUserPayload(text, topicBlock),
          1024,
          onDelta,
        ),
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
      const scopeRes = await runStage("数据范围判断", (onDelta) =>
        callLlmChatJsonObjectStreaming(
          env,
          buildDataScopeSystemPrompt(),
          buildDataScopeUserPayload(text, topicBlock),
          1024,
          onDelta,
        ),
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

    if (isReport) {
      const vis = reportPipelineVis;
      const picked = reportDateStalemate
        ? []
        : filterExtractionHistoryByReportScope(vis, reportScope.report_dates, reportScope.branch_companies, 8);
      const structured = buildReportStructuredArrayForLlm(picked);
      const stalemateNote = reportDateStalemate
        ? "【系统说明】本机可见提取历史中没有任何一条的「提取日期」与您问题中的日期相符，故未向模型传入报告 JSON。"
        : "";
      const rr = await runStage("数据记录判断", (onDelta) =>
        callLlmChatJsonObjectStreaming(
          env,
          buildReportDataRecordSystemPrompt(),
          buildReportDataRecordUserPayload(
            text,
            REPORT_PRODUCTION_STRUCTURE_DOC,
            structured,
            [reportPipelineContextNote, stalemateNote].filter(Boolean).join("\n\n") || undefined,
          ),
          8192,
          onDelta,
        ),
      );
      callbacks?.onFinalAnswerLoading?.();
      const judged = parseReportDataRecordJudgmentJson(rr.content);
      const rawReportAns = judged?.answer ?? rr.content.trim().slice(0, 12000);
      const answerFromReport = rawReportAns || "（空回复）";
      const idLine =
        picked.length > 0
          ? picked.map((h) => h.id).join("、")
          : reportDateStalemate
            ? "日期僵局·无记录入模"
            : "无匹配提取记录";
      const recordSummary =
        judged?.record_set_summary ?? `共匹配 ${picked.length} 条提取记录（当前视角内）。`;
      return {
        ok: true,
        data: {
          kind: "report",
          answer: answerFromReport,
          router,
          scopeDescription,
          idLine,
          recordSummary,
        },
      };
    }

    const recordRes = await runStage("数据记录判断", (onDelta) =>
      callLlmChatJsonObjectStreaming(
        env,
        buildDataRecordSystemPrompt(),
        buildDataRecordUserPayload(
          text,
          topicBlock,
          taskDataRecordScopeDescriptionForLlm,
          taskBranchScopeBaseline,
        ),
        2048,
        onDelta,
      ),
    );
    const recordParsed = parseDataRecordJson(recordRes.content);
    const taskCodes = recordParsed?.task_codes ?? [];
    const historyIds = recordParsed?.extraction_history_ids ?? [];
    const historyAll = loadExtractionHistory();
    const pickedTasks = pickTasksByCodes(tasks, taskCodes);
    const pickedHistory = pickHistoryByIds(historyAll, historyIds);
    const rows = [...tasksToLlmRows(pickedTasks), ...extractionItemsToLlmRows(pickedHistory)];
    const rowsJson = JSON.stringify(
      { rows, meta: { task_row_count: pickedTasks.length, report_row_count: pickedHistory.length } },
      null,
      2,
    );

    callbacks?.onFinalAnswerLoading?.();
    const finalRes = await callLlmChatJsonObject(
      env,
      buildFinalDataAnswerSystemPrompt(),
      buildFinalDataAnswerUserPayload(text, rowsJson),
      4096,
    );
    const rawAnswer =
      parseFinalAnswerJson(finalRes.content) ?? finalRes.content.trim().slice(0, 12000);
    const answer = rawAnswer || "（空回复）";

    const idLine =
      pickedTasks.length || pickedHistory.length
        ? [
            pickedTasks.length && `任务:${pickedTasks.map((t) => t.code).join("、")}`,
            pickedHistory.length && `提取:${pickedHistory.map((h) => h.id).join("、")}`,
          ]
            .filter(Boolean)
            .join("；")
        : "—";

    return {
      ok: true,
      data: {
        kind: "task",
        answer,
        router,
        scopeDescription: `已明确数据范围：${scopeDescription}`,
        idLine,
      },
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { ok: false, error: err };
  }
}
