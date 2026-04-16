import { useCallback, useMemo, useState } from "react";
import type { ExtractionHistoryItem } from "../types/extractionHistory";
import { buildTimelineGroups } from "../utils/extractionHistoryGroup";
import {
  aggregateWorkshopMetrics,
  buildDayCapacityDashboard,
  type CapacityMetricSnapshot,
  type WorkshopDayMetrics,
} from "../utils/productionDashboardMetrics";
import { formatExtractionDate } from "../utils/llmExtract";

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

function MetricTiles({
  snap,
  dense,
  level = 1,
}: {
  snap: CapacityMetricSnapshot;
  dense?: boolean;
  /** 1=当日汇总卡片，2=分公司，3=车间 */
  level?: 1 | 2 | 3;
}) {
  const gridClass = [
    dense ? "report-dash-metric-grid report-dash-metric-grid--dense" : "report-dash-metric-grid",
    `report-dash-metric-grid--level${level}`,
  ].join(" ");
  return (
    <div className={gridClass}>
      <div className="report-dash-metric kpi-green">
        <div className="report-dash-metric-label">当日产能达成</div>
        <div className="report-dash-metric-value">{formatRate(snap.capacityRatePercent)}</div>
      </div>
      <div className="report-dash-metric kpi-blue">
        <div className="report-dash-metric-label">计划达成</div>
        <div className="report-dash-metric-value">{formatTons(snap.planTons)}</div>
      </div>
      <div className="report-dash-metric kpi-blue">
        <div className="report-dash-metric-label">实际达成</div>
        <div className="report-dash-metric-value">{formatTons(snap.actualTons)}</div>
      </div>
      <div className="report-dash-metric">
        <div className="report-dash-metric-label">偏差值</div>
        <div
          className={["report-dash-metric-value", deviationToneClass(snap.deviationTons)]
            .filter(Boolean)
            .join(" ")}
        >
          {formatDeviation(snap.deviationTons)}
        </div>
      </div>
    </div>
  );
}

function WorkshopRows({ workshops }: { workshops: WorkshopDayMetrics[] }) {
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
                <MetricTiles snap={snap} dense level={3} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function ReportDashboardTab({ history }: { history: ExtractionHistoryItem[] }) {
  const [viewDate, setViewDate] = useState(() => formatExtractionDate(new Date()));
  const [companiesOpen, setCompaniesOpen] = useState(false);
  const [openCompany, setOpenCompany] = useState<string | null>(null);

  const timelineDates = useMemo(() => buildTimelineGroups(history).map((g) => g.date), [history]);

  const model = useMemo(() => buildDayCapacityDashboard(history, viewDate), [history, viewDate]);

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

  return (
    <div className="report-dashboard-tab">
      <div className="report-dash-toolbar">
        <label className="report-dash-date-label">
          <span className="muted small">当日视角（提取日期）</span>
          <input
            type="date"
            className="fld report-dash-date-input"
            value={viewDate}
            onChange={(e) => {
              setViewDate(e.target.value);
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
          <button
            type="button"
            className={`report-dash-summary-trigger report-dash-tree-card--level1${companiesOpen ? " is-open" : ""}`}
            onClick={toggleCompaniesPanel}
            aria-expanded={companiesOpen}
          >
            <div className="report-dash-summary-head">
              <span className="report-dash-summary-title">当日产量指标（全部分公司汇总）</span>
              <span className="report-dash-chevron" aria-hidden>
                {companiesOpen ? "▲" : "▼"}
              </span>
            </div>
            <MetricTiles snap={model.daySummary} level={1} />
            <span className="muted tiny report-dash-summary-hint">点击整块展开各分公司明细</span>
          </button>
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
                        <button
                          type="button"
                          className={`report-dash-company-row report-dash-tree-card--level2${expanded ? " is-open" : ""}`}
                          onClick={() => toggleCompanyRow(c.companyName)}
                          aria-expanded={expanded}
                        >
                          <div className="report-dash-company-title">
                            <span className="report-dash-chevron" aria-hidden>
                              {expanded ? "▲" : "▼"}
                            </span>
                            <span className="report-dash-company-name">{c.companyName}</span>
                          </div>
                          <MetricTiles snap={c.summary} dense level={2} />
                        </button>
                      </div>
                      {expanded && (
                        <div className="report-dash-company-nested">
                          <div className="report-dash-tree-branch report-dash-tree-branch--depth2">
                            <WorkshopRows workshops={c.workshops} />
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
    </div>
  );
}
