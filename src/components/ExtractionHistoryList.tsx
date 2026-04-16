import { useEffect, useMemo, useState } from "react";
import type { ExtractionHistoryItem } from "../types/extractionHistory";
import { buildTimelineGroups } from "../utils/extractionHistoryGroup";
import { formatLlmStatsParts } from "../utils/formatLlmStats";
import { buildExtractionHistoryTitle } from "../utils/extractionHistoryTitle";
import { ReportJsonPreview } from "./ReportJsonPreview";

type TabId = "view" | "json" | "raw";

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

function prettyJson(item: ExtractionHistoryItem): string {
  if (item.parsedJson != null) {
    try {
      return JSON.stringify(item.parsedJson, null, 2);
    } catch {
      return item.rawModelResponse;
    }
  }
  try {
    const o = JSON.parse(item.rawModelResponse) as unknown;
    return JSON.stringify(o, null, 2);
  } catch {
    return item.rawModelResponse;
  }
}

export function ExtractionHistoryList({
  items,
  onRemove,
}: {
  items: ExtractionHistoryItem[];
  onRemove: (id: string) => void;
}) {
  const [tabById, setTabById] = useState<Record<string, TabId>>({});

  const setTab = (id: string, tab: TabId) => {
    setTabById((m) => ({ ...m, [id]: tab }));
  };

  const groups = useMemo(() => buildTimelineGroups(items), [items]);
  const [openByDate, setOpenByDate] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (groups.length === 0) {
      setOpenByDate({});
      return;
    }
    const validDates = new Set(groups.map((g) => g.date));
    setOpenByDate((prev) => {
      const next: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (validDates.has(k) && v) next[k] = true;
      }
      if (Object.keys(next).length === 0) {
        next[groups[0].date] = true;
      }
      return next;
    });
  }, [groups]);

  if (items.length === 0) {
    return (
      <section className="card history-section">
        <div className="history-title-row">
          <h2 className="history-title">提取历史</h2>
          <span className="history-count-badge" aria-label={`共 ${items.length} 条记录`}>
            共 {items.length} 条
          </span>
        </div>
        <p className="muted small">解析成功后点击「保存」，记录将出现在此处。</p>
      </section>
    );
  }

  return (
    <section className="card history-section">
      <div className="history-title-row">
        <h2 className="history-title">提取历史</h2>
        <span className="history-count-badge" aria-label={`共 ${items.length} 条记录`}>
          共 {items.length} 条
        </span>
      </div>

      <div className="history-timeline">
        {groups.map((g) => (
          <details
            key={g.date}
            className="timeline-date-node"
            open={Boolean(openByDate[g.date])}
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
                    activeTab={tabById[item.id] ?? "view"}
                    onTab={(tab) => setTab(item.id, tab)}
                    onRemove={() => onRemove(item.id)}
                  />
                ))}
              </ul>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function HistoryRow({
  item,
  activeTab,
  onTab,
  onRemove,
}: {
  item: ExtractionHistoryItem;
  activeTab: TabId;
  onTab: (t: TabId) => void;
  onRemove: () => void;
}) {
  const jsonStr = useMemo(() => prettyJson(item), [item]);
  const savedLabel = useMemo(() => formatSavedAt(item.savedAt), [item.savedAt]);
  const listTitle = useMemo(
    () =>
      item.displayTitle ??
      buildExtractionHistoryTitle(item.parsedJson, item.rawModelResponse) ??
      item.fileName,
    [item],
  );

  return (
    <li className="history-item card nested">
      <div className="history-item-shell">
        <details className="history-item-details">
          <summary
            className="history-item-summary"
            aria-label={`${listTitle}，点击展开或收起详情`}
          >
            <div className="history-item-head">
              <div className="history-head-main">
                <strong className="history-file">{listTitle}</strong>
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
                提取 view
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "json"}
                className={activeTab === "json" ? "history-tab active" : "history-tab"}
                onClick={() => onTab("json")}
              >
                提取 json
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "raw"}
                className={activeTab === "raw" ? "history-tab active" : "history-tab"}
                onClick={() => onTab("raw")}
              >
                原始数据
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
              {activeTab === "json" && <pre className="history-json-pre">{jsonStr}</pre>}
              {activeTab === "raw" && <pre className="history-raw-pre">{item.originalText}</pre>}
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
