/**
 * @fileoverview 任务看板「待安排任务」：AI 提取建议子卡片（数据来自已保存的提取历史）。
 */

import { useEffect, useMemo } from "react";
import type { ExtractionHistoryItem } from "../types/extractionHistory";
import {
  aiSuggestionTaskRowVisible,
  isPendingAiSplitDebugEnabled,
  splitPendingAiSuggestionForDisplay,
} from "../utils/buildPendingTasksFromSavedReport";
import { formatReportCalendarDateZh } from "../utils/extractionHistoryGroup";
import { requestJumpToExtractionHistory } from "../utils/reportCitation";

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
            展示已保存提取历史中的 AI 建议摘要；点击「发起日期」可打开报告管理「提取历史」并定位到该条日报原文。
          </p>
        </div>
      </div>
      <div className="pending-arrange-grid">
        <AiSuggestionSubCard items={aiItems} />
      </div>
    </section>
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
