/**
 * @fileoverview 原文引用右侧抽屉：遮罩不虚化主界面；侧栏滑入与折叠态；摘录内仅对用户点击的 KPI 数值红字 + 闪烁红框。
 *
 * **设计要点**
 * - `wasOpenRef`：同一 `payload` 连续打开时不重复播放入场动画；真正从关到开才双 `requestAnimationFrame` 触发 `panelIn`。
 * - 关闭用定时器与 `CITATION_PANEL_MS` 对齐 CSS transition，再通知 `onClose`。
 *
 * @module ReportCitationDrawer
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ReportCitationPayload } from "../utils/reportCitation";
import { mergeExcerptHighlightRanges } from "../utils/quantitativeMetricCitations";

const CITATION_PANEL_MS = 360;

function clipHighlightRanges(
  ranges: { start: number; end: number }[],
  len: number,
): { start: number; end: number }[] {
  return mergeExcerptHighlightRanges(
    ranges
      .map((r) => ({
        start: Math.max(0, Math.min(r.start, len)),
        end: Math.max(0, Math.min(r.end, len)),
      }))
      .filter((r) => r.end > r.start),
  );
}

function renderQuotedWithCitationHighlights(quoted: string, ranges: { start: number; end: number }[]): ReactNode {
  const merged = clipHighlightRanges(ranges, quoted.length);
  if (merged.length === 0) return quoted;
  const parts: ReactNode[] = [];
  let cursor = 0;
  merged.forEach((rg, i) => {
    if (cursor < rg.start) parts.push(<span key={`t-${i}`}>{quoted.slice(cursor, rg.start)}</span>);
    parts.push(
      <span key={`h-${i}`} className="report-citation-quote-num">
        {quoted.slice(rg.start, rg.end)}
      </span>,
    );
    cursor = rg.end;
  });
  if (cursor < quoted.length) parts.push(<span key="t-end">{quoted.slice(cursor)}</span>);
  return <>{parts}</>;
}

/**
 * @param open - 是否挂载遮罩与面板（无 payload 时内部不展示内容）
 * @param collapsed - 窄条折叠态，仍保持 `open` 为 true
 * @param onJump - 用户确认跳转至提取历史（父级应调用 `requestJumpToExtractionHistory`）
 */
export function ReportCitationDrawer({
  open,
  collapsed,
  payload,
  onClose,
  onCollapse,
  onExpand,
  onJump,
}: {
  open: boolean;
  collapsed: boolean;
  payload: ReportCitationPayload | null;
  onClose: () => void;
  onCollapse: () => void;
  onExpand: () => void;
  onJump: () => void;
}) {
  const [panelIn, setPanelIn] = useState(false);
  const [backdropIn, setBackdropIn] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const wasOpenRef = useRef(false);

  const clearCloseTimer = () => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  useEffect(() => () => clearCloseTimer(), []);

  useEffect(() => {
    if (!open || !payload) {
      clearCloseTimer();
      setPanelIn(false);
      setBackdropIn(false);
      wasOpenRef.current = false;
      return;
    }
    clearCloseTimer();
    const alreadyVisible = wasOpenRef.current;
    wasOpenRef.current = true;
    if (!alreadyVisible) {
      setPanelIn(false);
      setBackdropIn(false);
      const a = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setBackdropIn(true);
          setPanelIn(true);
        });
      });
      return () => window.cancelAnimationFrame(a);
    }
    setBackdropIn(true);
    setPanelIn(true);
  }, [open, payload]);

  if (!open || !payload) return null;

  const runClose = () => {
    clearCloseTimer();
    setPanelIn(false);
    setBackdropIn(false);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, CITATION_PANEL_MS);
  };

  return (
    <div className={`report-citation-drawer-root${backdropIn ? " report-citation-drawer-root--in" : ""}`}>
      <button
        type="button"
        className="report-citation-drawer-backdrop"
        onClick={runClose}
        aria-label="关闭原文引用"
      />
      <aside
        className={[
          "report-citation-drawer",
          panelIn ? "report-citation-drawer--in" : "",
          collapsed ? "report-citation-drawer--collapsed" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label="原文引用"
      >
        <div className="report-citation-drawer-head">
          <h3 className="report-citation-drawer-title">原文引用</h3>
          <button
            type="button"
            className="report-citation-drawer-close-icon"
            onClick={onCollapse}
            aria-label="收起侧栏"
            title="收起"
          >
            ✕
          </button>
        </div>
        {!collapsed && (
          <div className="report-citation-drawer-body">
            <div className="report-citation-meta">
              <div>
                <span className="muted tiny">报告日期</span>
                <div className="report-citation-meta-value">{payload.viewDate}</div>
              </div>
              <div>
                <span className="muted tiny">公司名称</span>
                <div className="report-citation-meta-value">{payload.displayCompany}</div>
              </div>
              <div>
                <span className="muted tiny">当前指标</span>
                <div className="report-citation-meta-value">{payload.metricLabel}</div>
              </div>
            </div>
            <blockquote className="report-citation-quote">
              {renderQuotedWithCitationHighlights(
                payload.quotedExcerpt,
                payload.citationHighlightRanges ?? [],
              )}
            </blockquote>
            <div className="report-citation-actions">
              <button
                type="button"
                className="primary-btn"
                disabled={!payload.sourceItemId}
                onClick={onJump}
                title={payload.sourceItemId ? "打开报告管理并定位到该条历史" : "未找到对应历史记录"}
              >
                跳转原文
              </button>
            </div>
          </div>
        )}
        {collapsed && (
          <button type="button" className="report-citation-drawer-expand-tab" onClick={onExpand} title="展开原文引用">
            原文
          </button>
        )}
      </aside>
    </div>
  );
}
