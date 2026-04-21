/**
 * @fileoverview 数据看板「销售看板」：进货单分布卡片，按高/低/零散订单数下钻销售组与业务员（树形布局对齐报告看板当日产量）。
 *
 * @module SalesDashboardTab
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  buildSalesInboundDashboards,
  type InboundSegmentCounts,
  type MaterialModelInboundRow,
  type MaterialNameInboundRow,
  type SalesTeamInboundRow,
} from "../utils/salesInboundDistributionDashboard";

/** 使三级指标栅格与同级二级栅格同宽且左缘对齐，从而高/低/零散各列右缘对齐。 */
function alignInboundL3GridsToL2(blockEl: HTMLElement) {
  const l2Grid = blockEl.querySelector<HTMLElement>(".sales-dash-inbound-level2-metrics .sales-dash-inbound-grid");
  const l3Wraps = blockEl.querySelectorAll<HTMLElement>(".sales-dash-inbound-l3-tiles-align");
  if (!l2Grid || l3Wraps.length === 0) {
    l3Wraps.forEach((node) => {
      node.style.width = "";
      node.style.marginLeft = "";
    });
    return;
  }
  const l2Rect = l2Grid.getBoundingClientRect();
  const w = Math.round(l2Rect.width);
  const l2Left = l2Rect.left;
  l3Wraps.forEach((el) => {
    const card = el.closest(".report-dash-workshop-card");
    if (!card) return;
    const cardRect = card.getBoundingClientRect();
    const pl = parseFloat(getComputedStyle(card).paddingLeft) || 0;
    const contentLeft = cardRect.left + pl;
    const ml = Math.round(l2Left - contentLeft);
    el.style.width = `${w}px`;
    el.style.marginLeft = `${ml}px`;
  });
}

function InboundCountTiles({
  counts,
  dense,
}: {
  counts: InboundSegmentCounts;
  dense?: boolean;
}) {
  const gridClass = dense
    ? "sales-dash-inbound-grid sales-dash-inbound-grid--dense"
    : "sales-dash-inbound-grid";

  const tile = (kind: "fragmented" | "low" | "high", label: string, value: number) => (
    <div className={`sales-dash-inbound-tile sales-dash-inbound-tile--${kind}`}>
      <div className="sales-dash-inbound-tile-label">{label}</div>
      <div className="sales-dash-inbound-tile-value">{value}</div>
    </div>
  );

  return (
    <div className={gridClass}>
      {tile("high", "高", counts.high)}
      {tile("low", "低", counts.low)}
      {tile("fragmented", "零散", counts.fragmented)}
    </div>
  );
}

function PersonRailIcon({ title }: { title: string }) {
  return (
    <span className="sales-dash-tree-person-icon" aria-hidden title={title}>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.75" />
        <path
          d="M5 20c0-3.8 3.15-6 7-6s7 2.2 7 6"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

function PersonRows({ people }: { people: SalesTeamInboundRow["people"] }) {
  if (people.length === 0) {
    return <p className="muted small report-dash-nested-empty">暂无业务员明细。</p>;
  }
  return (
    <ul className="report-dash-workshop-list report-dash-workshop-list--tree sales-dash-inbound-person-list">
      {people.map((p) => (
        <li key={p.salesperson} className="report-dash-workshop-row">
          <div className="report-dash-workshop-head-shell">
            <div className="report-dash-tree-rail report-dash-tree-rail--level3">
              <PersonRailIcon title={p.salesperson} />
            </div>
            <div className="report-dash-workshop-card report-dash-tree-card--level3">
              <div className="report-dash-workshop-name">{p.salesperson}</div>
              <div className="sales-dash-inbound-l3-tiles-align">
                <InboundCountTiles counts={p.counts} dense />
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** 品名行：与业务员行共用树轨与指标对齐样式 */
function ProductNameRows({ names }: { names: MaterialNameInboundRow[] }) {
  if (names.length === 0) {
    return <p className="muted small report-dash-nested-empty">暂无品名明细。</p>;
  }
  return (
    <ul className="report-dash-workshop-list report-dash-workshop-list--tree sales-dash-inbound-person-list">
      {names.map((row) => (
        <li key={row.name} className="report-dash-workshop-row">
          <div className="report-dash-workshop-head-shell">
            <div className="report-dash-tree-rail report-dash-tree-rail--level3">
              <PersonRailIcon title={row.name} />
            </div>
            <div className="report-dash-workshop-card report-dash-tree-card--level3">
              <div className="report-dash-workshop-name">{row.name}</div>
              <div className="sales-dash-inbound-l3-tiles-align">
                <InboundCountTiles counts={row.counts} dense />
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function InboundTeamBlock({
  team,
  expanded,
  onToggle,
}: {
  team: SalesTeamInboundRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const blockRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = blockRef.current;
    if (!expanded) {
      el?.querySelectorAll<HTMLElement>(".sales-dash-inbound-l3-tiles-align").forEach((node) => {
        node.style.width = "";
        node.style.marginLeft = "";
      });
      return;
    }

    const schedule = () => {
      if (blockRef.current) alignInboundL3GridsToL2(blockRef.current);
    };
    schedule();
    const raf = requestAnimationFrame(schedule);
    const l2Grid = el?.querySelector(".sales-dash-inbound-level2-metrics .sales-dash-inbound-grid");
    const ro = new ResizeObserver(schedule);
    if (l2Grid) ro.observe(l2Grid);
    if (el) ro.observe(el);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [expanded, team.salesGroup, team.people]);

  return (
    <div
      ref={blockRef}
      className="report-dash-company-block report-dash-tree-node report-dash-tree-node--level2 sales-dash-inbound-company-block"
    >
      <div className="report-dash-company-head-shell">
        <div className="report-dash-tree-rail report-dash-tree-rail--level2">
          <button
            type="button"
            className={`report-dash-tree-node-btn${expanded ? " is-open" : ""}`}
            aria-expanded={expanded}
            aria-label={`${expanded ? "收起" : "展开"}${team.salesGroup}下属业务员明细`}
            title={expanded ? "收起业务员" : "展开业务员"}
            onClick={onToggle}
          >
            <span className="report-dash-tree-node-btn-inner" aria-hidden />
          </button>
        </div>
        <div className={`report-dash-company-row report-dash-tree-card--level2${expanded ? " is-open" : ""}`}>
          <button
            type="button"
            className="report-dash-company-toggle"
            onClick={onToggle}
            aria-expanded={expanded}
          >
            <div className="report-dash-company-title">
              <span className="report-dash-chevron" aria-hidden>
                {expanded ? "▲" : "▼"}
              </span>
              <span className="report-dash-company-name">{team.salesGroup}</span>
            </div>
          </button>
          <div className="report-dash-company-metrics sales-dash-inbound-level2-metrics">
            <InboundCountTiles counts={team.counts} dense />
          </div>
        </div>
      </div>
      {expanded && (
        <div className="report-dash-company-nested">
          <div className="report-dash-tree-branch report-dash-tree-branch--depth2">
            <PersonRows people={team.people} />
          </div>
        </div>
      )}
    </div>
  );
}

function InboundModelBlock({
  row,
  expanded,
  onToggle,
}: {
  row: MaterialModelInboundRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const blockRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = blockRef.current;
    if (!expanded) {
      el?.querySelectorAll<HTMLElement>(".sales-dash-inbound-l3-tiles-align").forEach((node) => {
        node.style.width = "";
        node.style.marginLeft = "";
      });
      return;
    }

    const schedule = () => {
      if (blockRef.current) alignInboundL3GridsToL2(blockRef.current);
    };
    schedule();
    const raf = requestAnimationFrame(schedule);
    const l2Grid = el?.querySelector(".sales-dash-inbound-level2-metrics .sales-dash-inbound-grid");
    const ro = new ResizeObserver(schedule);
    if (l2Grid) ro.observe(l2Grid);
    if (el) ro.observe(el);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [expanded, row.model, row.names]);

  return (
    <div
      ref={blockRef}
      className="report-dash-company-block report-dash-tree-node report-dash-tree-node--level2 sales-dash-inbound-company-block"
    >
      <div className="report-dash-company-head-shell">
        <div className="report-dash-tree-rail report-dash-tree-rail--level2">
          <button
            type="button"
            className={`report-dash-tree-node-btn${expanded ? " is-open" : ""}`}
            aria-expanded={expanded}
            aria-label={`${expanded ? "收起" : "展开"}型号「${row.model}」下属品名明细`}
            title={expanded ? "收起品名" : "展开品名"}
            onClick={onToggle}
          >
            <span className="report-dash-tree-node-btn-inner" aria-hidden />
          </button>
        </div>
        <div className={`report-dash-company-row report-dash-tree-card--level2${expanded ? " is-open" : ""}`}>
          <button
            type="button"
            className="report-dash-company-toggle"
            onClick={onToggle}
            aria-expanded={expanded}
          >
            <div className="report-dash-company-title">
              <span className="report-dash-chevron" aria-hidden>
                {expanded ? "▲" : "▼"}
              </span>
              <span className="report-dash-company-name">{row.model}</span>
            </div>
          </button>
          <div className="report-dash-company-metrics sales-dash-inbound-level2-metrics">
            <InboundCountTiles counts={row.counts} dense />
          </div>
        </div>
      </div>
      {expanded && (
        <div className="report-dash-company-nested">
          <div className="report-dash-tree-branch report-dash-tree-branch--depth2">
            <ProductNameRows names={row.names} />
          </div>
        </div>
      )}
    </div>
  );
}

export function SalesDashboardTab() {
  const [dataVersion, setDataVersion] = useState(0);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") setDataVersion((v) => v + 1);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  const dash = useMemo(() => buildSalesInboundDashboards(), [dataVersion]);
  const [drillOpen, setDrillOpen] = useState(false);
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const [drillOpenMaterial, setDrillOpenMaterial] = useState(false);
  const [openModel, setOpenModel] = useState<string | null>(null);

  useEffect(() => {
    setDrillOpen(false);
    setOpenTeam(null);
    setDrillOpenMaterial(false);
    setOpenModel(null);
  }, [dataVersion]);

  const toggleDrill = useCallback(() => {
    setDrillOpen((o) => {
      const next = !o;
      if (!next) setOpenTeam(null);
      return next;
    });
  }, []);

  const toggleTeam = useCallback((name: string) => {
    setOpenTeam((prev) => (prev === name ? null : name));
  }, []);

  const toggleDrillMaterial = useCallback(() => {
    setDrillOpenMaterial((o) => {
      const next = !o;
      if (!next) setOpenModel(null);
      return next;
    });
  }, []);

  const toggleModel = useCallback((name: string) => {
    setOpenModel((prev) => (prev === name ? null : name));
  }, []);

  if (!dash.ok) {
    return (
      <div className="report-dashboard-tab">
        <p className="report-hint">{dash.reason}</p>
      </div>
    );
  }

  const { rowCount, unclassifiedCount, segmentResult, summary, teams, models } = dash;
  const { fragmented_limit: fl, high_limit: hl } = segmentResult.thresholds;

  return (
    <div className="report-dashboard-tab">
      <div className="report-dash-tree">
        <div className="report-dash-tree-node report-dash-tree-node--level1">
          <div
            className={`report-dash-summary-card report-dash-tree-card--level1${drillOpen ? " is-open" : ""}`}
          >
            <button
              type="button"
              className="report-dash-summary-toggle"
              onClick={toggleDrill}
              aria-expanded={drillOpen}
            >
              <div className="report-dash-summary-head">
                <span className="report-dash-summary-title">订货单分布（团队/人维度）</span>
                <span className="report-dash-chevron" aria-hidden>
                  {drillOpen ? "▲" : "▼"}
                </span>
              </div>
            </button>
            <div className="report-dash-summary-metrics">
              <InboundCountTiles counts={summary} />
            </div>
            <span className="muted tiny report-dash-summary-hint">
              共 {rowCount} 条底表记录；已分档 {summary.fragmented + summary.low + summary.high} 条
              {unclassifiedCount > 0 ? `；未计入三档 ${unclassifiedCount} 条（非正或无法解析数量）` : ""}
              。分档阈值：零散 &lt; {fl}；低 {fl} ≤ 单笔 ≤ {hl}；高 &gt; {hl}（与「销售预测」生成数量分类规则一致）。点击标题下钻销售组与业务员。
            </span>
          </div>
        </div>

        {drillOpen && (
          <div className="report-dash-tree-branch report-dash-tree-branch--depth1">
            <div className="report-dash-companies">
              {teams.length === 0 ? (
                <p className="muted small">暂无销售组数据。</p>
              ) : (
                teams.map((team) => (
                  <InboundTeamBlock
                    key={team.salesGroup}
                    team={team}
                    expanded={openTeam === team.salesGroup}
                    onToggle={() => toggleTeam(team.salesGroup)}
                  />
                ))
              )}
            </div>
          </div>
        )}

        <div className="report-dash-tree-node report-dash-tree-node--level1 sales-dash-inbound-second-tree">
          <div
            className={`report-dash-summary-card report-dash-tree-card--level1${drillOpenMaterial ? " is-open" : ""}`}
          >
            <button
              type="button"
              className="report-dash-summary-toggle"
              onClick={toggleDrillMaterial}
              aria-expanded={drillOpenMaterial}
            >
              <div className="report-dash-summary-head">
                <span className="report-dash-summary-title">订货单分布（团队/人维度）指标图</span>
                <span className="report-dash-chevron" aria-hidden>
                  {drillOpenMaterial ? "▲" : "▼"}
                </span>
              </div>
            </button>
            <div className="report-dash-summary-metrics">
              <InboundCountTiles counts={summary} />
            </div>
            <span className="muted tiny report-dash-summary-hint">
              与上图同一分档口径。二级按<strong>型号</strong>汇总，三级按<strong>品名</strong>汇总（来自销售底表物料解析标签）。点击标题下钻。
            </span>
          </div>
        </div>

        {drillOpenMaterial && (
          <div className="report-dash-tree-branch report-dash-tree-branch--depth1">
            <div className="report-dash-companies">
              {models.length === 0 ? (
                <p className="muted small">暂无型号数据。</p>
              ) : (
                models.map((mrow) => (
                  <InboundModelBlock
                    key={mrow.model}
                    row={mrow}
                    expanded={openModel === mrow.model}
                    onToggle={() => toggleModel(mrow.model)}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
