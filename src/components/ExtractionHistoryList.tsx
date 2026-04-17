/**
 * @fileoverview 提取历史时间线：按日折叠（默认全部展开）、单条记录卡片默认展开，含结构化提取 / 原始报告 / 引用提取 Tab、删除、从看板跳转时的高亮与滚动；可打开归档抽屉。
 *
 * **设计要点**
 * - `extractionFocus` 由父级在读完 `sessionStorage` 后传入；消费后调用 `onExtractionFocusConsumed` 清空，防止二次滚动。
 * - 跳转后滚动：`scrollExtractionRawHighlightIntoView` 先滚整条 `history-item`，再按几何关系设置 `history-raw-pre` 的 `scrollTop`（pre 为独立滚动区）。
 * - `highlightOriginalText` 对 `needle` 做单次 `indexOf` 包裹 `<mark>`（`id` 供滚动到黄标位置）；`needle` 须为原文真实子串（与 `buildQuotedCitationExcerpt` 的 `jumpNeedle` 一致）。
 *
 * - 「引用提取」Tab：展示保存时生成的量化指标与原文 ±50 字引用（见 `buildQuantitativeMetricCitations`）。
 *
 * @module ExtractionHistoryList
 */

import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import type { ExtractionHistoryItem, QuantitativeMetricCitation } from "../types/extractionHistory";
import { buildTimelineGroups } from "../utils/extractionHistoryGroup";
import { mergeExcerptHighlightRanges } from "../utils/quantitativeMetricCitations";
import { formatLlmStatsParts } from "../utils/formatLlmStats";
import { buildExtractionHistoryTitle } from "../utils/extractionHistoryTitle";
import { ReportDataArchiveDrawer } from "./ReportDataArchiveDrawer";
import { ReportJsonPreview } from "./ReportJsonPreview";

type TabId = "view" | "raw" | "citations";

/** 兼容旧会话中曾选中的「json」Tab，统一回到结构化提取 */
function normalizeHistoryTab(tab: string | undefined): TabId {
  if (tab === "raw" || tab === "citations") return tab;
  return "view";
}

function formatSavedAt(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function highlightOriginalText(text: string, needle: string | null, markIdSuffix?: string): ReactNode {
  if (!needle) return text;
  const i = text.indexOf(needle);
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark
        id={markIdSuffix ? `history-raw-mark-${markIdSuffix}` : undefined}
        className="history-raw-highlight"
      >
        {text.slice(i, i + needle.length)}
      </mark>
      {text.slice(i + needle.length)}
    </>
  );
}

/** 将整条记录滚入视口，并把「原始报告」内可滚动的 pre 滚到黄标位置（pre 有 max-height + overflow:auto，仅 scrollIntoView 不够）。 */
function scrollExtractionRawHighlightIntoView(itemId: string) {
  const row = document.getElementById(`history-item-${itemId}`);
  const pre = document.getElementById(`history-raw-${itemId}`) as HTMLElement | null;
  const mark = document.getElementById(`history-raw-mark-${itemId}`) as HTMLElement | null;

  row?.scrollIntoView({ behavior: "smooth", block: "start" });

  if (pre && mark && pre.contains(mark)) {
    const preRect = pre.getBoundingClientRect();
    const markRect = mark.getBoundingClientRect();
    const relativeTop = markRect.top - preRect.top + pre.scrollTop;
    const desiredTop = relativeTop - pre.clientHeight / 2 + markRect.height / 2;
    const maxTop = Math.max(0, pre.scrollHeight - pre.clientHeight);
    pre.scrollTo({ top: Math.max(0, Math.min(desiredTop, maxTop)), behavior: "smooth" });
  } else if (pre) {
    pre.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function citationExcerptHighlights(r: QuantitativeMetricCitation): { start: number; end: number }[] {
  if (r.excerptHighlights?.length) return mergeExcerptHighlightRanges(r.excerptHighlights);
  if (r.matchIndex >= 0 && typeof r.excerptStart === "number") {
    const s = r.matchIndex - r.excerptStart;
    const e = s + r.valueText.length;
    if (s >= 0 && e <= r.excerpt.length) return [{ start: s, end: e }];
  }
  const i = r.excerpt.indexOf(r.valueText);
  if (i >= 0) return [{ start: i, end: i + r.valueText.length }];
  return [];
}

function CitationExcerptCell({ row }: { row: QuantitativeMetricCitation }) {
  const text = row.excerpt;
  const ranges = mergeExcerptHighlightRanges(citationExcerptHighlights(row));
  if (ranges.length === 0) {
    return <pre className="history-citations-excerpt-pre">{text}</pre>;
  }
  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((rg, i) => {
    const lo = Math.max(0, Math.min(rg.start, text.length));
    const hi = Math.max(lo, Math.min(rg.end, text.length));
    if (cursor < lo) parts.push(<span key={`t-${i}-a`}>{text.slice(cursor, lo)}</span>);
    if (lo < hi) parts.push(<mark key={`m-${i}`} className="history-citations-value-mark">{text.slice(lo, hi)}</mark>);
    cursor = hi;
  });
  if (cursor < text.length) parts.push(<span key="t-end">{text.slice(cursor)}</span>);
  return <pre className="history-citations-excerpt-pre">{parts}</pre>;
}

function MetricCitationsTable({ item }: { item: ExtractionHistoryItem }) {
  const rows = item.quantitativeMetricCitations ?? [];
  if (rows.length === 0) {
    return (
      <p className="muted small history-citations-empty">
        暂无引用提取数据。旧记录保存时尚未生成该表，或本次解析结果无法遍历为指标叶子。
      </p>
    );
  }
  return (
    <div className="history-citations-wrap">
      <table className="history-citations-table">
        <thead>
          <tr>
            <th scope="col">指标路径</th>
            <th scope="col">指标值</th>
            <th scope="col">引用原文</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={`${r.path}::${idx}`}>
              <td className="history-citations-path" title={r.path}>
                <span className="history-citations-label">{r.metricLabel}</span>
                <span className="muted tiny history-citations-subpath">{r.path}</span>
              </td>
              <td className="history-citations-value">
                {r.sourceKind === "auto_computed" ? (
                  <>
                    <span className="history-citations-value-auto" title="由同组计划值与实际值推算">
                      自动计算
                    </span>
                    <span className="muted small history-citations-value-paren">（{r.valueText}）</span>
                  </>
                ) : (
                  r.valueText
                )}
              </td>
              <td className="history-citations-excerpt">
                <CitationExcerptCell row={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * @param items - 当前历史列表
 * @param onRemove - 删除单条并回写 storage 由父级处理
 * @param extractionFocus - 可选；看板跳转时携带目标 `id` 与正文 `needle`
 * @param onExtractionFocusConsumed - 焦点应用后通知父级清除，避免保留状态
 * @param onRefreshQuantitativeCitations - 按时间线顺序逐条重算引用提取并持久化
 * @param citationsRefreshing - 刷新进行中，禁用按钮
 * @param extraTitleActions - 标题行右侧额外操作（如导出/导入）
 */
export function ExtractionHistoryList({
  items,
  onRemove,
  extractionFocus,
  onExtractionFocusConsumed,
  onRefreshQuantitativeCitations,
  citationsRefreshing = false,
  extraTitleActions,
}: {
  items: ExtractionHistoryItem[];
  onRemove: (id: string) => void;
  extractionFocus?: { id: string; needle: string } | null;
  onExtractionFocusConsumed?: () => void;
  onRefreshQuantitativeCitations?: () => void | Promise<void>;
  citationsRefreshing?: boolean;
  extraTitleActions?: ReactNode;
}) {
  const [tabById, setTabById] = useState<Record<string, TabId>>({});
  const [rawHighlight, setRawHighlight] = useState<{ id: string; needle: string } | null>(null);
  const [archiveItem, setArchiveItem] = useState<ExtractionHistoryItem | null>(null);
  const [archiveDrawerOpen, setArchiveDrawerOpen] = useState(false);
  const [archiveDrawerCollapsed, setArchiveDrawerCollapsed] = useState(false);

  const setTab = (id: string, tab: TabId) => {
    setTabById((m) => ({ ...m, [id]: tab }));
  };

  const groups = useMemo(() => buildTimelineGroups(items), [items]);
  const [openByDate, setOpenByDate] = useState<Record<string, boolean>>({});
  const [itemDetailsOpen, setItemDetailsOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (items.length === 0) {
      setArchiveDrawerOpen(false);
      setArchiveItem(null);
      setArchiveDrawerCollapsed(false);
    }
  }, [items.length]);

  useLayoutEffect(() => {
    if (groups.length === 0) {
      setOpenByDate({});
      return;
    }
    setOpenByDate((prev) => {
      const next: Record<string, boolean> = {};
      for (const g of groups) {
        const d = g.date;
        next[d] = prev[d] !== undefined ? Boolean(prev[d]) : true;
      }
      return next;
    });
  }, [groups]);

  useLayoutEffect(() => {
    if (items.length === 0) {
      setItemDetailsOpen({});
      return;
    }
    setItemDetailsOpen((prev) => {
      const next: Record<string, boolean> = {};
      for (const it of items) {
        next[it.id] = prev[it.id] !== undefined ? Boolean(prev[it.id]) : true;
      }
      return next;
    });
  }, [items]);

  useEffect(() => {
    if (!extractionFocus) return;
    const { id, needle } = extractionFocus;
    if (!items.some((i) => i.id === id)) {
      onExtractionFocusConsumed?.();
      return;
    }
    const g = groups.find((gr) => gr.items.some((it) => it.id === id));
    if (g) setOpenByDate((m) => ({ ...m, [g.date]: true }));
    setItemDetailsOpen((m) => ({ ...m, [id]: true }));
    setTabById((m) => ({ ...m, [id]: "raw" }));
    setRawHighlight({ id, needle });
    onExtractionFocusConsumed?.();
    const t1 = window.setTimeout(() => {
      requestAnimationFrame(() => scrollExtractionRawHighlightIntoView(id));
    }, 450);
    const t2 = window.setTimeout(() => {
      requestAnimationFrame(() => scrollExtractionRawHighlightIntoView(id));
    }, 900);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [extractionFocus, groups, items, onExtractionFocusConsumed]);

  if (items.length === 0) {
    return (
      <section className="card history-section">
        <div className="history-title-row">
          <h2 className="history-title">提取历史</h2>
          <span className="history-count-badge" aria-label={`共 ${items.length} 条记录`}>
            共 {items.length} 条
          </span>
          {(extraTitleActions || onRefreshQuantitativeCitations) && (
            <div className="history-title-actions">
              {extraTitleActions}
              {onRefreshQuantitativeCitations && (
                <button
                  type="button"
                  className="ghost-btn tiny-btn"
                  disabled={citationsRefreshing}
                  onClick={() => void onRefreshQuantitativeCitations()}
                  title="按时间线顺序逐条重算各记录的引用提取并保存到本地"
                >
                  {citationsRefreshing ? "刷新中…" : "刷新引用提取"}
                </button>
              )}
            </div>
          )}
        </div>
        <p className="muted small">解析成功后点击「保存」，记录将出现在此处。</p>
      </section>
    );
  }

  return (
    <>
      <section id="extraction-history-section" className="card history-section">
      <div className="history-title-row">
        <h2 className="history-title">提取历史</h2>
        <span className="history-count-badge" aria-label={`共 ${items.length} 条记录`}>
          共 {items.length} 条
        </span>
        {(extraTitleActions || onRefreshQuantitativeCitations) && (
          <div className="history-title-actions">
            {extraTitleActions}
            {onRefreshQuantitativeCitations && (
              <button
                type="button"
                className="ghost-btn tiny-btn"
                disabled={citationsRefreshing}
                onClick={() => void onRefreshQuantitativeCitations()}
                title="按时间线顺序逐条重算各记录的引用提取并保存到本地"
              >
                {citationsRefreshing ? "刷新中…" : "刷新引用提取"}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="history-timeline">
        {groups.map((g) => (
          <details
            key={g.date}
            className="timeline-date-node"
            open={openByDate[g.date] ?? true}
            onToggle={(e) => {
              const el = e.currentTarget;
              setOpenByDate((m) => ({ ...m, [g.date]: el.open }));
            }}
          >
            <summary className="timeline-date-summary">
              <span className="timeline-date-dot" aria-hidden />
              <span className="timeline-date-label">{g.date}</span>
              <span className="timeline-date-meta">
                {g.branchCount} 个分公司 · {g.totalItems} 条
              </span>
            </summary>
            <div className="timeline-date-body">
              <ul className="timeline-record-list">
                {g.items.map((item) => (
                  <HistoryRow
                    key={item.id}
                    item={item}
                    activeTab={normalizeHistoryTab(tabById[item.id])}
                    onTab={(tab) => setTab(item.id, tab)}
                    onRemove={() => onRemove(item.id)}
                    rawHighlightNeedle={rawHighlight?.id === item.id ? rawHighlight.needle : null}
                    detailsOpen={itemDetailsOpen[item.id] ?? true}
                    onDetailsOpenChange={(open) =>
                      setItemDetailsOpen((m) => ({ ...m, [item.id]: open }))
                    }
                    onViewFile={() => {
                      setArchiveItem(item);
                      setArchiveDrawerOpen(true);
                      setArchiveDrawerCollapsed(false);
                    }}
                  />
                ))}
              </ul>
            </div>
          </details>
        ))}
      </div>
    </section>
    <ReportDataArchiveDrawer
      open={archiveDrawerOpen}
      collapsed={archiveDrawerCollapsed}
      item={archiveItem}
      onClose={() => {
        setArchiveDrawerOpen(false);
        setArchiveItem(null);
        setArchiveDrawerCollapsed(false);
      }}
      onToggleCollapse={() => setArchiveDrawerCollapsed((c) => !c)}
    />
    </>
  );
}

function HistoryRow({
  item,
  activeTab,
  onTab,
  onRemove,
  onViewFile,
  rawHighlightNeedle,
  detailsOpen,
  onDetailsOpenChange,
}: {
  item: ExtractionHistoryItem;
  activeTab: TabId;
  onTab: (t: TabId) => void;
  onRemove: () => void;
  onViewFile: () => void;
  rawHighlightNeedle: string | null;
  detailsOpen: boolean;
  onDetailsOpenChange: (open: boolean) => void;
}) {
  const savedLabel = useMemo(() => formatSavedAt(item.savedAt), [item.savedAt]);
  const listTitle = useMemo(
    () =>
      item.displayTitle ??
      buildExtractionHistoryTitle(item.parsedJson, item.rawModelResponse) ??
      item.fileName,
    [item],
  );

  useEffect(() => {
    if (rawHighlightNeedle) onDetailsOpenChange(true);
  }, [rawHighlightNeedle, item.id, onDetailsOpenChange]);

  return (
    <li id={`history-item-${item.id}`} className="history-item card nested">
      <div className="history-item-shell">
        <details
          className="history-item-details"
          open={detailsOpen}
          onToggle={(e) => onDetailsOpenChange(e.currentTarget.open)}
        >
          <summary
            className="history-item-summary"
            aria-label={`${listTitle}，点击展开或收起详情`}
          >
            <div className="history-item-head">
              <div className="history-head-main">
                <div className="history-head-title-row">
                  <strong className="history-file">{listTitle}</strong>
                  <button
                    type="button"
                    className="ghost-btn tiny-btn history-view-file-btn"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onViewFile();
                    }}
                  >
                    查看文件
                  </button>
                </div>
                <span className="muted tiny history-time">{savedLabel}</span>
                {item.llmStats && (
                  <div className="history-llm-stats" aria-label="大模型调用统计">
                    {formatLlmStatsParts(item.llmStats).map((part, i) => (
                      <span key={i} className="history-llm-stat-chip">
                        {part}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <span className="history-item-chevron" aria-hidden>
                ▼
              </span>
            </div>
          </summary>
          <div className="history-item-expanded">
            <div className="history-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "view"}
                className={activeTab === "view" ? "history-tab active" : "history-tab"}
                onClick={() => onTab("view")}
              >
                结构化提取
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "raw"}
                className={activeTab === "raw" ? "history-tab active" : "history-tab"}
                onClick={() => onTab("raw")}
              >
                原始报告
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "citations"}
                className={activeTab === "citations" ? "history-tab active" : "history-tab"}
                onClick={() => onTab("citations")}
              >
                引用提取
              </button>
            </div>
            <div className="history-panel" role="tabpanel">
              {activeTab === "view" && (
                <div className="history-panel-body">
                  {item.parsedJson != null ? (
                    <ReportJsonPreview data={item.parsedJson} />
                  ) : (
                    <pre className="json-fallback">{item.rawModelResponse}</pre>
                  )}
                </div>
              )}
              {activeTab === "raw" && (
                <pre id={`history-raw-${item.id}`} className="history-raw-pre">
                  {highlightOriginalText(item.originalText, rawHighlightNeedle, item.id)}
                </pre>
              )}
              {activeTab === "citations" && <MetricCitationsTable item={item} />}
            </div>
          </div>
        </details>
        <button type="button" className="text-btn danger history-item-delete-btn" onClick={onRemove}>
          删除
        </button>
      </div>
    </li>
  );
}
