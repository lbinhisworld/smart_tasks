/**
 * @fileoverview 首页「报告看板」Tab：按提取日展示集团 / 分公司 / 车间三级产量树与 KPI 瓷片，并驱动原文引用侧栏。
 *
 * **设计要点**
 * - 数据来自 `buildDayCapacityDashboard`；日期轴选项来自 `buildTimelineGroups` 的日期键；提取日筛选使用自定义月历，有历史数据的日期标绿。
 * - 点击指标瓷片调用 `openCitation`：车间级用单条摘录；集团/分公司**加总**指标用 `buildAggregatedDashboardCitation` 合并各车间下级摘录与高亮。
 *
 * @module ReportDashboardTab
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { ExtractionHistoryItem } from "../types/extractionHistory";
import { buildTimelineGroups } from "../utils/extractionHistoryGroup";
import {
  aggregateWorkshopMetrics,
  buildDayCapacityDashboard,
  type CapacityMetricSnapshot,
  type WorkshopDayMetrics,
} from "../utils/productionDashboardMetrics";
import {
  buildAggregatedDashboardCitation,
  buildQuotedCitationExcerpt,
  CITATION_METRIC_LABELS,
  type CitationMetricId,
  findHighlightRangeInQuoted,
  pickHistorySourceItem,
  type ReportCitationPayload,
  tryBuildCitationFromStoredQuantitative,
} from "../utils/reportCitation";
import { formatExtractionDate } from "../utils/llmExtract";
import { reportDashboardLevel1ScopeLabel } from "../utils/leaderPerspective";
import { ReportCitationDrawer } from "./ReportCitationDrawer";
import { ReportDashboardDateField } from "./ReportDashboardDateField";

function formatRate(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return "暂无";
  return `${p.toFixed(1)}%`;
}

function formatTons(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "暂无";
  return `${n.toFixed(2)} 吨`;
}

function formatDeviation(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "暂无";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)} 吨`;
}

function deviationToneClass(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "";
  if (n < 0) return "report-dash-deviation--negative";
  if (n > 0) return "report-dash-deviation--positive";
  return "";
}

/** 与瓷片展示一致的可选字符串，用于在摘录中定位「当前点击」那一项的数值（优先长串匹配）。 */
function buildCitationHighlightPhrases(metric: CitationMetricId, snap: CapacityMetricSnapshot): string[] {
  const phrases: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t && t !== "暂无") phrases.push(t);
  };

  switch (metric) {
    case "capacity": {
      push(formatRate(snap.capacityRatePercent));
      const p = snap.capacityRatePercent;
      if (p != null && Number.isFinite(p)) {
        push(`${p.toFixed(1)}%`);
        push(`${p.toFixed(2)}%`);
      }
      break;
    }
    case "plan": {
      push(formatTons(snap.planTons));
      const v = snap.planTons;
      if (v != null && Number.isFinite(v)) {
        push(`${v.toFixed(2)} 吨`);
        push(`${v.toFixed(2)}吨`);
        if (Number.isInteger(v)) {
          push(`${v} 吨`);
          push(`${v}吨`);
        }
      }
      break;
    }
    case "actual": {
      push(formatTons(snap.actualTons));
      const v = snap.actualTons;
      if (v != null && Number.isFinite(v)) {
        push(`${v.toFixed(2)} 吨`);
        push(`${v.toFixed(2)}吨`);
        if (Number.isInteger(v)) {
          push(`${v} 吨`);
          push(`${v}吨`);
        }
      }
      break;
    }
    case "deviation": {
      push(formatDeviation(snap.deviationTons));
      const v = snap.deviationTons;
      if (v != null && Number.isFinite(v)) {
        const sign = v > 0 ? "+" : "";
        push(`${sign}${v.toFixed(2)} 吨`);
        push(`${sign}${v.toFixed(2)}吨`);
        push(`${v.toFixed(2)} 吨`);
        push(`${v.toFixed(2)}吨`);
        if (Number.isInteger(v)) {
          push(`${sign}${v} 吨`);
          push(`${v} 吨`);
        }
      }
      break;
    }
  }

  return [...new Set(phrases)];
}

function MetricTiles({
  snap,
  dense,
  level = 1,
  onMetricClick,
}: {
  snap: CapacityMetricSnapshot;
  dense?: boolean;
  level?: 1 | 2 | 3;
  onMetricClick?: (metric: CitationMetricId, snap: CapacityMetricSnapshot) => void;
}) {
  const gridClass = [
    dense ? "report-dash-metric-grid report-dash-metric-grid--dense" : "report-dash-metric-grid",
    `report-dash-metric-grid--level${level}`,
    onMetricClick ? " report-dash-metric-grid--clickable" : "",
  ]
    .join(" ")
    .trim();

  const wrap = (metric: CitationMetricId, className: string, inner: ReactNode) => {
    if (onMetricClick) {
      return (
        <button
          type="button"
          className={[className, "report-dash-metric", "report-dash-metric--tile-btn"].filter(Boolean).join(" ")}
          onClick={(e) => {
            e.stopPropagation();
            onMetricClick(metric, snap);
          }}
        >
          {inner}
        </button>
      );
    }
    return <div className={[className, "report-dash-metric"].filter(Boolean).join(" ")}>{inner}</div>;
  };

  return (
    <div className={gridClass}>
      {wrap(
        "capacity",
        "kpi-green",
        <>
          <div className="report-dash-metric-label">当日产能达成</div>
          <div className="report-dash-metric-value">{formatRate(snap.capacityRatePercent)}</div>
        </>,
      )}
      {wrap(
        "plan",
        "kpi-blue",
        <>
          <div className="report-dash-metric-label">计划达成</div>
          <div className="report-dash-metric-value">{formatTons(snap.planTons)}</div>
        </>,
      )}
      {wrap(
        "actual",
        "kpi-blue",
        <>
          <div className="report-dash-metric-label">实际达成</div>
          <div className="report-dash-metric-value">{formatTons(snap.actualTons)}</div>
        </>,
      )}
      {wrap(
        "deviation",
        "",
        <>
          <div className="report-dash-metric-label">偏差值</div>
          <div
            className={["report-dash-metric-value", deviationToneClass(snap.deviationTons)]
              .filter(Boolean)
              .join(" ")}
          >
            {formatDeviation(snap.deviationTons)}
          </div>
        </>,
      )}
    </div>
  );
}

function WorkshopRows({
  workshops,
  onMetricClick,
}: {
  workshops: WorkshopDayMetrics[];
  onMetricClick: (workshopName: string, metric: CitationMetricId, snap: CapacityMetricSnapshot) => void;
}) {
  if (workshops.length === 0) {
    return <p className="muted small report-dash-nested-empty">未解析到车间当日产量结构。</p>;
  }
  return (
    <ul className="report-dash-workshop-list report-dash-workshop-list--tree">
      {workshops.map((w) => {
        const snap = aggregateWorkshopMetrics([w]);
        return (
          <li key={w.workshopName} className="report-dash-workshop-row">
            <div className="report-dash-workshop-head-shell">
              <div className="report-dash-tree-rail report-dash-tree-rail--level3">
                <span
                  className="report-dash-tree-nav-dot"
                  aria-hidden
                  title={w.workshopName}
                />
              </div>
              <div className="report-dash-workshop-card report-dash-tree-card--level3">
                <div className="report-dash-workshop-name">{w.workshopName}</div>
                <MetricTiles
                  snap={snap}
                  dense
                  level={3}
                  onMetricClick={(m, snap) => onMetricClick(w.workshopName, m, snap)}
                />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * @param history - 当前内存中的提取历史（父级已按视角过滤）
 * @param perspective - 当前视角，用于一级汇总卡片括号内说明
 */
export function ReportDashboardTab({
  history,
  perspective,
}: {
  history: ExtractionHistoryItem[];
  perspective: string;
}) {
  const [viewDate, setViewDate] = useState(() => formatExtractionDate(new Date()));
  const [companiesOpen, setCompaniesOpen] = useState(false);
  const [openCompany, setOpenCompany] = useState<string | null>(null);

  const [citationOpen, setCitationOpen] = useState(false);
  const [citationCollapsed, setCitationCollapsed] = useState(false);
  const [citationPayload, setCitationPayload] = useState<ReportCitationPayload | null>(null);

  const timelineDates = useMemo(() => buildTimelineGroups(history).map((g) => g.date), [history]);

  const model = useMemo(() => buildDayCapacityDashboard(history, viewDate), [history, viewDate]);

  const level1ScopeLabel = useMemo(() => reportDashboardLevel1ScopeLabel(perspective), [perspective]);

  const toggleCompaniesPanel = useCallback(() => {
    setCompaniesOpen((o) => {
      const next = !o;
      if (!next) setOpenCompany(null);
      return next;
    });
  }, []);

  const toggleCompanyRow = useCallback((name: string) => {
    setOpenCompany((prev) => (prev === name ? null : name));
  }, []);

  const openCitation = useCallback(
    (
      metric: CitationMetricId,
      ctx: { level: 1 | 2 | 3; companyName?: string; workshopName?: string },
      snap: CapacityMetricSnapshot,
    ) => {
      const companyName =
        ctx.level === 1 ? null : ctx.companyName != null ? ctx.companyName : null;
      const workshopName = ctx.level === 3 ? ctx.workshopName ?? null : null;

      if (ctx.level === 1 || ctx.level === 2) {
        const segments =
          ctx.level === 1
            ? model.companies.flatMap((c) =>
                c.workshops.map((w) => ({
                  companyName: c.companyName,
                  workshopName: w.workshopName,
                  highlightPhrases: buildCitationHighlightPhrases(
                    metric,
                    aggregateWorkshopMetrics([w]),
                  ),
                })),
              )
            : model.companies
                .filter((c) => c.companyName === ctx.companyName)
                .flatMap((c) =>
                  c.workshops.map((w) => ({
                    companyName: c.companyName,
                    workshopName: w.workshopName,
                    highlightPhrases: buildCitationHighlightPhrases(
                      metric,
                      aggregateWorkshopMetrics([w]),
                    ),
                  })),
                );

        if (segments.length > 0) {
          const agg = buildAggregatedDashboardCitation(history, viewDate, metric, segments, {
            scope: ctx.level === 1 ? "group" : "company",
          });
          if (agg) {
            const displayCompany =
              ctx.level === 1 ? "全集团汇总" : ctx.companyName ?? "—";
            setCitationPayload({
              viewDate,
              displayCompany,
              metricLabel: CITATION_METRIC_LABELS[metric],
              quotedExcerpt: agg.quotedExcerpt,
              sourceItemId: agg.sourceItemId,
              jumpNeedle: agg.jumpNeedle,
              citationHighlightRanges: agg.citationHighlightRanges,
            });
            setCitationOpen(true);
            setCitationCollapsed(false);
            return;
          }
        }
      }

      const highlightPhrases = buildCitationHighlightPhrases(metric, snap);
      const source = pickHistorySourceItem(history, viewDate, companyName, workshopName, highlightPhrases);
      const text = source?.originalText ?? "";
      const stored =
        source != null ? tryBuildCitationFromStoredQuantitative(source, metric, workshopName, highlightPhrases) : null;
      let quotedExcerpt: string;
      let jumpNeedle: string;
      let citationHighlightRanges: { start: number; end: number }[];
      if (stored) {
        quotedExcerpt = stored.quotedExcerpt;
        jumpNeedle = stored.jumpNeedle;
        citationHighlightRanges = stored.citationHighlightRanges;
      } else {
        const { quoted, jumpNeedle: jn } = buildQuotedCitationExcerpt(text, {
          metric,
          workshopName,
          companyName: companyName ?? undefined,
          centerOnPhrases: highlightPhrases,
          maxLen: 280,
          viewDate,
        });
        quotedExcerpt = quoted;
        jumpNeedle = jn;
        const single = findHighlightRangeInQuoted(quoted, highlightPhrases);
        citationHighlightRanges = single ? [single] : [];
      }
      const displayCompany =
        ctx.level === 1 ? "全集团汇总" : ctx.companyName ?? "—";
      setCitationPayload({
        viewDate,
        displayCompany,
        metricLabel: CITATION_METRIC_LABELS[metric],
        quotedExcerpt,
        sourceItemId: source?.id ?? null,
        jumpNeedle,
        citationHighlightRanges,
      });
      setCitationOpen(true);
      setCitationCollapsed(false);
    },
    [history, viewDate, model],
  );

  return (
    <div className="report-dashboard-tab">
      <div className="report-dash-toolbar">
        <label className="report-dash-date-label">
          <span className="muted small">当日视角（提取日期）</span>
          <ReportDashboardDateField
            value={viewDate}
            datesWithData={timelineDates}
            onChange={(iso) => {
              setViewDate(iso);
              setCompaniesOpen(false);
              setOpenCompany(null);
            }}
          />
        </label>
        {timelineDates.length > 0 && (
          <span className="muted tiny report-dash-date-hint">
            历史中有数据的日期可切换上方日期查看；当前共 {timelineDates.length} 个提取日。
          </span>
        )}
      </div>

      {!model.hasYieldData && (
        <p className="report-hint">
          该日暂无「产量达成分析」结构化数据。请先在「历史」中解析并保存报告，且模型需返回{" "}
          <code>production_report → 2.1 产量达成分析</code> 下车间与「当日产量(吨)」字段。
        </p>
      )}

      <div className="report-dash-tree">
        <div className="report-dash-tree-node report-dash-tree-node--level1">
          <div
            className={`report-dash-summary-card report-dash-tree-card--level1${companiesOpen ? " is-open" : ""}`}
          >
            <button
              type="button"
              className="report-dash-summary-toggle"
              onClick={toggleCompaniesPanel}
              aria-expanded={companiesOpen}
            >
              <div className="report-dash-summary-head">
                <span className="report-dash-summary-title">当日产量指标（{level1ScopeLabel}）</span>
                <span className="report-dash-chevron" aria-hidden>
                  {companiesOpen ? "▲" : "▼"}
                </span>
              </div>
            </button>
            <div className="report-dash-summary-metrics">
              <MetricTiles
                snap={model.daySummary}
                level={1}
                onMetricClick={(m, snap) => openCitation(m, { level: 1 }, snap)}
              />
            </div>
            <span className="muted tiny report-dash-summary-hint">点击标题展开各分公司明细；点击指标格查看原文引用。</span>
          </div>
        </div>

        {companiesOpen && (
          <div className="report-dash-tree-branch report-dash-tree-branch--depth1">
            <div className="report-dash-companies">
              {model.companies.length === 0 ? (
                <p className="muted small">该提取日期下没有已保存的记录。</p>
              ) : (
                model.companies.map((c) => {
                  const expanded = openCompany === c.companyName;
                  return (
                    <div key={c.companyName} className="report-dash-company-block report-dash-tree-node report-dash-tree-node--level2">
                      <div className="report-dash-company-head-shell">
                        <div className="report-dash-tree-rail report-dash-tree-rail--level2">
                          <button
                            type="button"
                            className={`report-dash-tree-node-btn${expanded ? " is-open" : ""}`}
                            aria-expanded={expanded}
                            aria-label={`${expanded ? "收起" : "展开"}${c.companyName}下属车间明细`}
                            title={expanded ? "收起车间" : "展开车间"}
                            onClick={() => toggleCompanyRow(c.companyName)}
                          >
                            <span className="report-dash-tree-node-btn-inner" aria-hidden />
                          </button>
                        </div>
                        <div className={`report-dash-company-row report-dash-tree-card--level2${expanded ? " is-open" : ""}`}>
                          <button
                            type="button"
                            className="report-dash-company-toggle"
                            onClick={() => toggleCompanyRow(c.companyName)}
                            aria-expanded={expanded}
                          >
                            <div className="report-dash-company-title">
                              <span className="report-dash-chevron" aria-hidden>
                                {expanded ? "▲" : "▼"}
                              </span>
                              <span className="report-dash-company-name">{c.companyName}</span>
                            </div>
                          </button>
                          <div className="report-dash-company-metrics">
                            <MetricTiles
                              snap={c.summary}
                              dense
                              level={2}
                              onMetricClick={(m, snap) => openCitation(m, { level: 2, companyName: c.companyName }, snap)}
                            />
                          </div>
                        </div>
                      </div>
                      {expanded && (
                        <div className="report-dash-company-nested">
                          <div className="report-dash-tree-branch report-dash-tree-branch--depth2">
                            <WorkshopRows
                              workshops={c.workshops}
                              onMetricClick={(workshopName, metric, snap) =>
                                openCitation(metric, {
                                  level: 3,
                                  companyName: c.companyName,
                                  workshopName,
                                }, snap)
                              }
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      <ReportCitationDrawer
        open={citationOpen}
        collapsed={citationCollapsed}
        payload={citationPayload}
        onClose={() => {
          setCitationOpen(false);
          setCitationCollapsed(false);
          setCitationPayload(null);
        }}
        onCollapse={() => setCitationCollapsed(true)}
        onExpand={() => setCitationCollapsed(false)}
      />
    </div>
  );
}
