/**
 * @fileoverview 「报告归档」侧栏：拉取 `report_data.md`，按历史记录 `id` 匹配归档条目；失败或未命中时用单条历史合并根兜底。
 *
 * **设计要点**
 * - `open`+`item` 变化时异步 `loadReportArchiveEntries`；`cancelled` 防止竞态 setState。
 * - 展示树为递归 `ArchiveTreeNode`，浅层键名与长文本样式区分。
 *
 * @module ReportDataArchiveDrawer
 */

import { useEffect, useState } from "react";
import type { ExtractionHistoryItem } from "../types/extractionHistory";
import {
  buildArchiveRootFromHistoryItem,
  findArchiveEntryById,
  loadReportArchiveEntries,
} from "../utils/reportDataArchive";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function formatPreview(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function ArchiveTreeNode({ name, value, depth }: { name: string; value: unknown; depth: number }) {
  const blue = depth < 2;
  const keyCls = blue ? "report-archive-key report-archive-key--blue" : "report-archive-key";
  const valCls = blue ? "report-archive-val report-archive-val--blue" : "report-archive-val";

  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const str = value === null ? "null" : String(value);
    const isLong = typeof value === "string" && value.length > 400;
    return (
      <div className={`report-archive-row report-archive-row--depth${depth}`}>
        <span className={keyCls}>{name}</span>
        {isLong ? (
          <pre className={`report-archive-pre ${blue ? "report-archive-pre--blue" : ""}`}>{str}</pre>
        ) : (
          <span className={valCls}>{str}</span>
        )}
      </div>
    );
  }

  if (Array.isArray(value)) {
    return (
      <details className={`report-archive-block report-archive-block--depth${depth}`} open={depth < 2}>
        <summary className={blue ? "report-archive-summary report-archive-summary--blue" : "report-archive-summary"}>
          {name}
          <span className="report-archive-meta">数组 · {value.length} 项</span>
        </summary>
        <div className="report-archive-block-body">
          {value.map((el, i) => (
            <ArchiveTreeNode key={i} name={`[${i}]`} value={el} depth={depth + 1} />
          ))}
        </div>
      </details>
    );
  }

  if (isRecord(value)) {
    const keys = Object.keys(value);
    return (
      <details className={`report-archive-block report-archive-block--depth${depth}`} open={depth < 2}>
        <summary className={blue ? "report-archive-summary report-archive-summary--blue" : "report-archive-summary"}>
          {name}
          <span className="report-archive-meta">{keys.length} 个字段</span>
        </summary>
        <div className="report-archive-block-body">
          {keys.map((k) => (
            <ArchiveTreeNode key={k} name={k} value={value[k]} depth={depth + 1} />
          ))}
        </div>
      </details>
    );
  }

  return (
    <div className={`report-archive-row report-archive-row--depth${depth}`}>
      <span className={keyCls}>{name}</span>
      <pre className={blue ? "report-archive-pre report-archive-pre--blue" : "report-archive-pre"}>
        {formatPreview(value)}
      </pre>
    </div>
  );
}

/**
 * @param item - 当前选中的提取历史；`id` 用于在归档数组中查找
 * @param collapsed - 折叠为窄条，保留标题栏与切换按钮
 */
export function ReportDataArchiveDrawer({
  open,
  collapsed,
  item,
  onClose,
  onToggleCollapse,
}: {
  open: boolean;
  collapsed: boolean;
  item: ExtractionHistoryItem | null;
  onClose: () => void;
  onToggleCollapse: () => void;
}) {
  const [root, setRoot] = useState<Record<string, unknown> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !item) {
      setRoot(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const entries = await loadReportArchiveEntries();
        if (cancelled) return;
        const hit = findArchiveEntryById(entries, item.id);
        setRoot(hit ?? buildArchiveRootFromHistoryItem(item));
        setLoadError(null);
      } catch (e) {
        if (cancelled) return;
        setRoot(buildArchiveRootFromHistoryItem(item));
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, item]);

  if (!open || !item) return null;

  const title = item.displayTitle ?? item.fileName ?? "报告归档";

  return (
    <div className="report-archive-drawer-root">
      <button type="button" className="report-archive-drawer-backdrop" onClick={onClose} aria-label="关闭侧栏" />
      <aside
        className={`report-archive-drawer${collapsed ? " report-archive-drawer--collapsed" : ""}`}
        aria-hidden={false}
      >
        <div className="report-archive-drawer-head">
          <h3 className="report-archive-drawer-title">{title}</h3>
          <div className="report-archive-drawer-actions">
            <button type="button" className="ghost-btn tiny-btn" onClick={onToggleCollapse} title={collapsed ? "展开侧栏" : "折叠侧栏"}>
              {collapsed ? "展开" : "折叠"}
            </button>
            <button type="button" className="ghost-btn tiny-btn" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
        {!collapsed && (
          <div className="report-archive-drawer-body">
            {loadError && (
              <p className="report-hint warn report-archive-drawer-hint">
                未能加载 <code>report_data.md</code>，已改为仅展示当前历史记录合并结果：{loadError}
              </p>
            )}
            <p className="muted tiny report-archive-drawer-source">
              数据来源：<code>public/report_data.md</code>（按 id 匹配）；前两级字段名与文本为蓝色高亮。
            </p>
            {root && (
              <div className="report-archive-tree">
                {Object.keys(root).map((k) => (
                  <ArchiveTreeNode key={k} name={k} value={root[k]} depth={0} />
                ))}
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
