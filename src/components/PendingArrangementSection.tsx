/**
 * @fileoverview 任务看板「待安排任务」：日报计划提取与 AI 提取建议两列子卡片（数据来自已保存的提取历史，保存时与读存储时生成）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTasks } from "../context/TaskContext";
import type { ExtractionHistoryItem, PendingDailyPlanTaskRow } from "../types/extractionHistory";
import type { Task } from "../types/task";
import {
  aiSuggestionTaskRowVisible,
  dailyPlanTaskRowVisible,
  isPendingAiSplitDebugEnabled,
  splitPendingAiSuggestionForDisplay,
} from "../utils/buildPendingTasksFromSavedReport";
import { formatReportCalendarDateZh } from "../utils/extractionHistoryGroup";
import { generateTaskInputFromDailyPlanRow } from "../utils/generateTaskFromDailyPlanRow";
import { LLM_CONFIG_CHANGED_EVENT, readLlmEnv } from "../utils/llmExtract";
import {
  appendDailyPlanRowToPlanHistory,
  loadPendingPlanDailyPlanRowIds,
  PLAN_HISTORY_UPDATED_EVENT,
} from "../utils/planHistoryStorage";
import { requestJumpToExtractionHistory } from "../utils/reportCitation";

/** 点击「生成任务」时：将当前视角置于领导指示文首；若文首已是该视角则不再重复拼接。领导指示为空时不加任何前缀。 */
function mergePerspectiveLeaderPrefix(perspective: string, existing: string): string {
  const p = perspective.trim();
  const e = existing.trim();
  if (!p) return e;
  if (!e) return "";
  if (e.startsWith(p)) return e;
  return `${p} ${e}`;
}

function ReportDateJumpLink({
  extractionHistoryId,
  jumpNeedle,
  reportDateIso,
}: {
  extractionHistoryId: string;
  jumpNeedle: string;
  reportDateIso: string;
}) {
  const label = formatReportCalendarDateZh(reportDateIso);
  return (
    <button
      type="button"
      className="pending-date-to-report"
      onClick={() => requestJumpToExtractionHistory(extractionHistoryId, jumpNeedle)}
    >
      {label}
    </button>
  );
}

export function PendingArrangementSection({
  perspective,
  extractionHistory,
}: {
  perspective: string;
  extractionHistory: ExtractionHistoryItem[];
}) {
  const { addTask, tasks } = useTasks();

  const dailyItems = useMemo(() => {
    const rows = extractionHistory.flatMap((h) => h.pendingDailyPlanTasks ?? []);
    return rows.filter((r) => dailyPlanTaskRowVisible(r, perspective));
  }, [extractionHistory, perspective]);

  const aiItems = useMemo(() => {
    const rows = extractionHistory.flatMap((h) => h.pendingAiSuggestionTasks ?? []);
    return rows.filter((r) => aiSuggestionTaskRowVisible(r, perspective));
  }, [extractionHistory, perspective]);

  useEffect(() => {
    if (!isPendingAiSplitDebugEnabled()) return;
    const sample = aiItems[0];
    console.info("[smart_tasks:PendingAiSuggestion] dashboard slice", {
      extractionHistoryLen: extractionHistory.length,
      aiRowCount: aiItems.length,
      sampleRow: sample
        ? {
            id: sample.id,
            discoveredIssueLen: sample.discoveredIssue?.length ?? 0,
            aiSuggestionLen: sample.aiSuggestion?.length ?? 0,
            discoveredIssueHead: sample.discoveredIssue?.slice(0, 120),
          }
        : null,
      hint: "关闭日志: localStorage.removeItem('DEBUG_PENDING_AI') 后刷新",
    });
  }, [
    extractionHistory.length,
    aiItems.length,
    aiItems[0]?.id,
    aiItems[0]?.discoveredIssue?.length,
    aiItems[0]?.aiSuggestion?.length,
  ]);

  return (
    <section className="card pending-arrange-section" aria-labelledby="pending-arrange-heading">
      <div className="card-head">
        <div>
          <h2 id="pending-arrange-heading">待安排任务</h2>
          <p className="muted small">
            数据在日报识别后点击「保存」写入提取历史时生成；点击「发起日期」打开报告管理「提取历史」并定位到该条日报原文。
          </p>
        </div>
      </div>
      <div className="pending-arrange-grid">
        <DailyPlanSubCard items={dailyItems} addTask={addTask} tasks={tasks} perspective={perspective} />
        <AiSuggestionSubCard items={aiItems} />
      </div>
    </section>
  );
}

function DailyPlanSubCard({
  items,
  addTask,
  tasks,
  perspective,
}: {
  items: NonNullable<ExtractionHistoryItem["pendingDailyPlanTasks"]>;
  addTask: (input: Omit<Task, "id" | "code" | "createdAt"> & { code?: string }) => Task;
  tasks: Task[];
  perspective: string;
}) {
  const [leaderByRowId, setLeaderByRowId] = useState<Record<string, string>>({});
  const [generatingRowId, setGeneratingRowId] = useState<string | null>(null);
  const [llmEpoch, setLlmEpoch] = useState(0);
  const [planHistoryBump, setPlanHistoryBump] = useState(0);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  useEffect(() => {
    const bump = () => setLlmEpoch((n) => n + 1);
    window.addEventListener(LLM_CONFIG_CHANGED_EVENT, bump);
    return () => window.removeEventListener(LLM_CONFIG_CHANGED_EVENT, bump);
  }, []);

  useEffect(() => {
    const bump = () => setPlanHistoryBump((n) => n + 1);
    window.addEventListener(PLAN_HISTORY_UPDATED_EVENT, bump);
    return () => window.removeEventListener(PLAN_HISTORY_UPDATED_EVENT, bump);
  }, []);

  /** 计划行 id → 由该行生成的任务（持久化在 Task.sourcePendingDailyPlanRowId，切换页面不丢） */
  const taskBySourcePlanRowId = useMemo(() => {
    const m = new Map<string, Task>();
    for (const t of tasks) {
      const sid = t.sourcePendingDailyPlanRowId?.trim();
      if (sid && !m.has(sid)) m.set(sid, t);
    }
    return m;
  }, [tasks]);

  /** 任务管理删除任务后标为「待计划」的计划行（未点「返回计划」前不在看板显示「生成任务」） */
  const pendingReturnRowIds = useMemo(() => loadPendingPlanDailyPlanRowIds(), [planHistoryBump]);

  const pendingReturnRef = useRef(pendingReturnRowIds);
  pendingReturnRef.current = pendingReturnRowIds;

  const llmReady = useMemo(() => readLlmEnv() !== null, [llmEpoch]);

  const rowBlockedForGenerate = useCallback((rowId: string) => {
    const rid = rowId.trim();
    if (!rid) return false;
    if (pendingReturnRef.current.has(rid)) return true;
    return tasksRef.current.some((t) => t.sourcePendingDailyPlanRowId?.trim() === rid);
  }, []);

  const onLeaderChange = useCallback((rowId: string, value: string) => {
    setLeaderByRowId((prev) => ({ ...prev, [rowId]: value }));
  }, []);

  const runGenerateRow = useCallback(
    async (
      row: PendingDailyPlanTaskRow,
      opts?: {
        skipIfAlreadyLinked?: boolean;
        /** 若传入则以此为准调用模型（避免 setState 异步导致仍读旧领导指示） */
        leaderInstructionOverride?: string;
        /** 若传入则在任务写入成功后立即追加一条计划历史（单行） */
        planHistoryPerspective?: string;
      },
    ) => {
      if (!readLlmEnv()) {
        throw new Error("未配置大模型：请先配置 DeepSeek API Key 或 LLM 环境变量后再生成任务。");
      }
      if (rowBlockedForGenerate(row.id)) {
        if (opts?.skipIfAlreadyLinked) return;
        throw new Error(
          "该计划行暂不可生成（已有任务、或已删除任务处于待计划）；请在任务管理 → 计划历史中处理。",
        );
      }
      setGeneratingRowId(row.id);
      try {
        const leaderInstruction = (opts?.leaderInstructionOverride ?? leaderByRowId[row.id] ?? "").trim();
        const input = await generateTaskInputFromDailyPlanRow({
          row,
          leaderInstruction,
          planPerspective: perspective,
        });
        addTask({ ...input, sourcePendingDailyPlanRowId: row.id });
        if (opts?.planHistoryPerspective) {
          appendDailyPlanRowToPlanHistory({
            row,
            leaderInstructionSnapshot: leaderInstruction,
            perspective: opts.planHistoryPerspective,
          });
        }
      } finally {
        setGeneratingRowId(null);
      }
    },
    [addTask, leaderByRowId, perspective, rowBlockedForGenerate],
  );

  const onGenerate = useCallback(
    async (row: PendingDailyPlanTaskRow) => {
      const combined = mergePerspectiveLeaderPrefix(perspective, leaderByRowId[row.id] ?? "");
      setLeaderByRowId((prev) => ({ ...prev, [row.id]: combined }));
      try {
        await runGenerateRow(row, {
          leaderInstructionOverride: combined,
          planHistoryPerspective: perspective,
        });
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
      }
    },
    [leaderByRowId, perspective, runGenerateRow],
  );

  const batchRunRef = useRef(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [batchDoneCountdown, setBatchDoneCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (batchDoneCountdown === null) return;
    if (batchDoneCountdown <= 0) {
      setBatchDoneCountdown(null);
      return;
    }
    const id = window.setTimeout(() => setBatchDoneCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [batchDoneCountdown]);

  const batchTargets = useMemo(
    () =>
      items.filter((row) => !taskBySourcePlanRowId.has(row.id) && !pendingReturnRowIds.has(row.id)),
    [items, taskBySourcePlanRowId, pendingReturnRowIds],
  );

  const onBatchGenerate = useCallback(async () => {
    if (!readLlmEnv()) {
      alert("未配置大模型：请先配置 DeepSeek API Key 或 LLM 环境变量后再批量生成。");
      return;
    }
    if (batchRunRef.current) return;
    if (items.length === 0) {
      alert("当前没有日报计划提取任务。");
      return;
    }
    const totalNeedingGen = items.filter((row) => !rowBlockedForGenerate(row.id)).length;
    if (totalNeedingGen === 0) {
      alert("当前列表中的计划均已生成任务，无需批量生成。");
      return;
    }
    batchRunRef.current = true;
    setBatchProgress({ done: 0, total: totalNeedingGen });
    let success = 0;
    let firstErr: string | null = null;
    /** 本批内已生成过的行 id（避免同表重复行在 React 尚未提交时 ref 未更新） */
    const linkedIdsThisBatch = new Set<string>();
    /** 批量内合并视角后的领导指示（闭包内累加，避免读到未提交的 setState） */
    let leaderScratch: Record<string, string> = { ...leaderByRowId };
    try {
      for (const row of items) {
        if (linkedIdsThisBatch.has(row.id) || rowBlockedForGenerate(row.id)) continue;
        try {
          const combined = mergePerspectiveLeaderPrefix(perspective, leaderScratch[row.id] ?? "");
          leaderScratch[row.id] = combined;
          setLeaderByRowId((prev) => ({ ...prev, [row.id]: combined }));
          await runGenerateRow(row, {
            skipIfAlreadyLinked: true,
            leaderInstructionOverride: combined,
            planHistoryPerspective: perspective,
          });
          linkedIdsThisBatch.add(row.id);
          success += 1;
          setBatchProgress({ done: success, total: totalNeedingGen });
        } catch (e) {
          firstErr = e instanceof Error ? e.message : String(e);
          break;
        }
      }
    } finally {
      batchRunRef.current = false;
      setBatchProgress(null);
      setGeneratingRowId(null);
    }
    if (firstErr) {
      alert(`批量生成已中断：${firstErr}\n已成功生成 ${success} 条。`);
    } else {
      setBatchDoneCountdown(3);
    }
  }, [items, leaderByRowId, perspective, runGenerateRow, rowBlockedForGenerate]);

  const batchBusy = batchProgress !== null;

  return (
    <div className="pending-sub-card">
      {batchDoneCountdown !== null && (
        <div className="modal-backdrop plan-batch-done-backdrop" role="presentation">
          <div
            className="modal plan-batch-done-modal"
            role="alertdialog"
            aria-labelledby="plan-batch-done-title"
            aria-live="polite"
            onClick={(e) => e.stopPropagation()}
          >
            <p id="plan-batch-done-title" className="plan-batch-done-msg">
              批量生成已结束。
            </p>
            <p className="muted small plan-batch-done-countdown">
              {batchDoneCountdown > 0 ? `${batchDoneCountdown} 秒后关闭` : "正在关闭…"}
            </p>
          </div>
        </div>
      )}
      <div className="pending-sub-card-head">
        <h3 className="pending-sub-card-title">日报计划提取任务</h3>
        <div className="pending-sub-card-actions">
          {batchBusy && <span className="pending-batch-spinner" aria-hidden />}
          <button
            type="button"
            className="ghost-btn tiny-btn pending-batch-gen-btn"
            disabled={!llmReady || batchBusy || batchTargets.length === 0}
            title={
              !llmReady
                ? "请先配置大模型 API"
                : batchTargets.length === 0
                  ? "没有待生成的计划行"
                  : "按表格顺序逐行调用生成（已生成的行会跳过）"
            }
            onClick={() => void onBatchGenerate()}
          >
            批量生成任务
            {batchProgress ? `（${batchProgress.done}/${batchProgress.total}）` : ""}
          </button>
        </div>
      </div>
      <div className="table-wrap pending-sub-table-wrap">
        <table className="data-table pending-sub-table pending-sub-table--pending-tasks pending-sub-table--daily-plan-gen">
          <thead>
            <tr>
              <th className="pending-sub-col-dept">发起部门</th>
              <th className="pending-sub-col-dept">执行部门</th>
              <th className="pending-sub-col-date">发起日期</th>
              <th>请求描述</th>
              <th className="pending-sub-col-leader">领导指示/建议</th>
              <th className="pending-sub-col-gen">任务生成</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => {
              const linkedTask = taskBySourcePlanRowId.get(row.id);
              const pendingPlanOnly = !linkedTask && pendingReturnRowIds.has(row.id);
              return (
              <tr key={row.id}>
                <td className="pending-sub-col-dept">{row.initiatingDepartment}</td>
                <td className="pending-sub-col-dept">{row.executingDepartment}</td>
                <td className="pending-sub-col-date">
                  <ReportDateJumpLink
                    extractionHistoryId={row.extractionHistoryId}
                    jumpNeedle={row.jumpNeedle}
                    reportDateIso={row.reportDate}
                  />
                </td>
                <td className="clamp wide">{row.requestDescription}</td>
                <td className="pending-sub-col-leader">
                  <input
                    type="text"
                    className="pending-leader-instruct-input"
                    value={leaderByRowId[row.id] ?? ""}
                    onChange={(e) => onLeaderChange(row.id, e.target.value)}
                    placeholder="截止日、协办部门等"
                    aria-label={`领导指示：${row.requestDescription.slice(0, 24)}`}
                  />
                </td>
                <td
                  className={`pending-sub-col-gen${linkedTask ? " pending-sub-col-gen--has-task" : ""}`}
                >
                  {linkedTask ? (
                    <span className="pending-gen-code" title={linkedTask.code}>
                      {linkedTask.code}
                    </span>
                  ) : pendingPlanOnly ? (
                    <span
                      className="pending-gen-pending-plan muted tiny"
                      title="已在任务管理删除对应任务；请打开任务管理 → 计划历史，对该记录点击「返回计划」后该条将从计划历史移除，即可在看板再次生成任务。"
                    >
                      待计划
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="text-btn pending-gen-task-btn"
                      disabled={generatingRowId === row.id || !llmReady || batchBusy}
                      title={!llmReady ? "请先配置大模型 API" : batchBusy ? "批量生成进行中" : undefined}
                      onClick={() => void onGenerate(row)}
                    >
                      {generatingRowId === row.id ? "生成中…" : "生成任务"}
                    </button>
                  )}
                </td>
              </tr>
            );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-cell">
                  当前视角下暂无待安排的日报计划提取任务。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AiSuggestionSubCard({
  items,
}: {
  items: NonNullable<ExtractionHistoryItem["pendingAiSuggestionTasks"]>;
}) {
  return (
    <div className="pending-sub-card">
      <h3 className="pending-sub-card-title">AI 提取建议任务</h3>
      <div className="table-wrap pending-sub-table-wrap">
        <table className="data-table pending-sub-table pending-sub-table--pending-tasks">
          <thead>
            <tr>
              <th className="pending-sub-col-dept">相关部门</th>
              <th className="pending-sub-col-date">发起日期</th>
              <th>发现的问题</th>
              <th>AI 建议</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => {
              const { problemText, suggestionText } = splitPendingAiSuggestionForDisplay(row);
              return (
                <tr key={row.id}>
                  <td className="pending-sub-col-dept muted tiny">{row.relatedDepartments}</td>
                  <td className="pending-sub-col-date">
                    <ReportDateJumpLink
                      extractionHistoryId={row.extractionHistoryId}
                      jumpNeedle={row.jumpNeedle}
                      reportDateIso={row.reportDate}
                    />
                  </td>
                  <td className="clamp wide">{problemText}</td>
                  <td className="pending-ai-suggestion-col">{suggestionText}</td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-cell">
                  当前视角下暂无 AI 提取建议任务。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
