/**
 * @fileoverview 报告管理「日报列表」页签：数据来自数据中台接口会话缓存；「刷新数据」与数据中台「发送测试请求」同源在线拉取并写缓存。
 * 接口按已保存偏好 / 首个有缓存 / 首个配置自动选择；支持分公司/职能部门与部门下拉、日报日期（默认不按日期筛；点选空日期时自动带入当天）、提交人筛选及日报详情抽屉。
 *
 * @module ReportDailyListPanel
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { ExternalApiProfile } from "../types/externalApiProfile";
import { loadDataHubState } from "../utils/externalApiStorage";
import { loadDataSyncLastBody } from "../utils/dataSyncResponseStorage";
import { DATA_HUB_CLEANED_JSON_PREFIX } from "../utils/dataHubCleanedJsonStorage";
import { DATA_HUB_BUSINESS_FILTER_CHANGED_EVENT } from "../utils/dataHubBusinessViewFilter";
import { parseScriptCleaningSpec, runGroupBranchWorkshopDateCleaning } from "../utils/dataHubScriptCleaning";
import {
  type DailyReportListDisplayRow,
  type DailyReportListFilters,
  filterDailyRowsExact,
  localIsoDate,
  parseDailyRowsForReportList,
  readPreferredDailyListProfileId,
  writePreferredDailyListProfileId,
  looksLikeHubListJson,
} from "../utils/reportDailyListFromDataHub";
import {
  loadHighlightsForRow,
  makeDailyRowKey,
  type DailyReportHighlightSpan,
  type DailyTopicDraftPayload,
} from "../utils/dailyReportTopicHighlightStorage";
import { runDataHubInterfaceTestFetch } from "../utils/dataHubInterfaceTestFetch";
import { getPlainTextRangeWithinElement } from "../utils/plainTextSelectionInElement";

/** 日报详情列表预览最大字符数 */
const REPORT_DETAIL_PREVIEW_CHARS = 50;

/** 与 `externalApiStorage` 中数据中台状态键一致，其它标签页写入后可触发本页刷新 profile 元数据 */
const DATA_HUB_STATE_STORAGE_KEY = "qifeng_data_hub_state_v1";

/** 首次进入：不按日报日期筛选（展示全部）；用户点选或聚焦日期框且仍为空时再填入当天，便于日历定位。 */
function initialFilters(): DailyReportListFilters {
  return {
    branchFunctional: "",
    deptWorkshop: "",
    submitter: "",
    reportDateIso: "",
  };
}

/** 清空条件：不限日期与其它字段 */
function emptyFilters(): DailyReportListFilters {
  return {
    branchFunctional: "",
    deptWorkshop: "",
    submitter: "",
    reportDateIso: "",
  };
}

/**
 * 日报日期为空时写入当天，便于用户点选日期控件时日历默认落在今天（用户仍可在日历中改选）。
 *
 * @param prev 当前筛选条件
 * @returns 若已选日期则原样返回，否则 `reportDateIso` 为 `localIsoDate()`
 */
function seedReportDateTodayIfEmpty(prev: DailyReportListFilters): DailyReportListFilters {
  if (prev.reportDateIso.trim() !== "") return prev;
  return { ...prev, reportDateIso: localIsoDate() };
}

function distinctSorted(values: string[]): string[] {
  const s = new Set(values.map((v) => v.trim()).filter(Boolean));
  return [...s].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function previewDetail(text: string): string {
  const t = text.trim();
  if (!t) return "—";
  if (t.length <= REPORT_DETAIL_PREVIEW_CHARS) return t;
  return `${t.slice(0, REPORT_DETAIL_PREVIEW_CHARS)}…`;
}

export interface ReportDailyListPanelProps {
  /** 将选中的日报摘录与行键、区间提交到「议题管理」新建（保存议题后回写高亮） */
  onAddToTopic?: (payload: DailyTopicDraftPayload) => void;
  /** 高亮存储更新后递增，用于重新读取 localStorage */
  highlightNonce?: number;
  /** 由报告提取侧递增时触发与「刷新数据」相同的在线拉取（Tab 隐藏时仍生效） */
  refreshNonce?: number;
}

/**
 * 日报列表主面板（仅展示与筛选，数据只读）。
 */
/**
 * 将正文按已保存区间切成文本与 `<mark>` 片段（供 `pre` 内批注式展示）。
 * @param text 日报全文
 * @param spans 已合并、裁剪前的区间列表
 */
function buildDetailPreChildren(text: string, spans: DailyReportHighlightSpan[]): ReactNode[] {
  const len = text.length;
  const clipped = spans
    .map((s) => ({
      ...s,
      start: Math.max(0, Math.min(s.start, len)),
      end: Math.max(0, Math.min(s.end, len)),
    }))
    .filter((s) => s.start < s.end)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: ReactNode[] = [];
  let c = 0;
  clipped.forEach((s, i) => {
    if (s.start > c) {
      out.push(
        <span key={`plain-${c}-${s.start}`} className="report-daily-detail-plain-seg">
          {text.slice(c, s.start)}
        </span>,
      );
    }
    out.push(
      <mark
        key={`mk-${s.start}-${s.end}-${i}`}
        className="report-daily-topic-highlight"
        title={s.topicCode ? `已关联议题 ${s.topicCode}` : "已由「添加至议题」标记"}
      >
        {text.slice(s.start, s.end)}
      </mark>,
    );
    c = s.end;
  });
  if (c < len) {
    out.push(
      <span key={`plain-tail-${c}`} className="report-daily-detail-plain-seg">
        {text.slice(c)}
      </span>,
    );
  }
  return out.length > 0 ? out : [text || "（空）"];
}

export function ReportDailyListPanel({
  onAddToTopic,
  highlightNonce = 0,
  refreshNonce = 0,
}: ReportDailyListPanelProps) {
  const [profiles, setProfiles] = useState<ExternalApiProfile[]>([]);
  const [profileId, setProfileId] = useState<string>(() => readPreferredDailyListProfileId() ?? "");
  const [filters, setFilters] = useState<DailyReportListFilters>(() => initialFilters());
  const [tick, setTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [detailDrawer, setDetailDrawer] = useState<{ text: string; rowKey: string } | null>(null);
  const detailPreRef = useRef<HTMLPreElement>(null);

  const drawerHighlightSpans = useMemo(() => {
    if (!detailDrawer) return [];
    return loadHighlightsForRow(detailDrawer.rowKey);
  }, [detailDrawer?.rowKey, detailDrawer?.text, highlightNonce]);

  const reloadHubState = useCallback(() => {
    setProfiles(loadDataHubState().profiles);
  }, []);

  useEffect(() => {
    reloadHubState();
  }, [reloadHubState, tick]);

  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    const onVis = () => {
      if (document.visibilityState === "visible") bump();
    };
    const onFocus = () => bump();
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === DATA_HUB_STATE_STORAGE_KEY) bump();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    const onHubFilter = () => bump();
    window.addEventListener(DATA_HUB_BUSINESS_FILTER_CHANGED_EVENT, onHubFilter);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(DATA_HUB_BUSINESS_FILTER_CHANGED_EVENT, onHubFilter);
    };
  }, []);

  /**
   * 无接口选择器时：校正无效 id；空则优先已保存偏好 → 首个有会话缓存的接口 → 首个接口。
   */
  useEffect(() => {
    if (profiles.length === 0) {
      if (profileId) {
        setProfileId("");
        writePreferredDailyListProfileId(null);
      }
      return;
    }
    if (profileId && profiles.some((p) => p.id === profileId)) return;

    const pref = readPreferredDailyListProfileId();
    if (pref && profiles.some((p) => p.id === pref)) {
      setProfileId(pref);
      return;
    }
    const withBody = profiles.find((p) => (loadDataSyncLastBody(p.id)?.trim() ?? "").length > 0);
    const pick = withBody ?? profiles[0]!;
    setProfileId(pick.id);
    writePreferredDailyListProfileId(pick.id);
  }, [profiles, profileId]);

  const cachedBody = useMemo(() => (profileId ? loadDataSyncLastBody(profileId) : null), [profileId, tick]);

  const parsedRows = useMemo((): DailyReportListDisplayRow[] => {
    if (!cachedBody) return [];
    return parseDailyRowsForReportList(profileId, cachedBody);
  }, [cachedBody, profileId, tick]);

  const branchOptions = useMemo(
    () => distinctSorted(parsedRows.map((r) => r.parentCompany)),
    [parsedRows],
  );
  const deptOptions = useMemo(
    () => distinctSorted(parsedRows.map((r) => r.deptWorkshop)),
    [parsedRows],
  );

  const filteredRows = useMemo(
    () => filterDailyRowsExact(parsedRows, filters),
    [parsedRows, filters],
  );

  const hubShapeOk = cachedBody ? looksLikeHubListJson(cachedBody) : false;

  useEffect(() => {
    if (!detailDrawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetailDrawer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailDrawer]);

  /**
   * 与数据中台当前接口「发送测试请求」一致：在线拉取并写入会话缓存，再刷新本页表格。
   */
  const handleRefreshData = useCallback(async () => {
    setRefreshError(null);
    if (!profileId) {
      window.alert("请先在下拉中选择数据源接口（或到「数据中台」配置接口）。");
      return;
    }
    const profile = profiles.find((x) => x.id === profileId);
    if (!profile) {
      window.alert("当前接口配置不存在，请刷新页面或到「数据中台」检查。");
      return;
    }
    setRefreshing(true);
    try {
      const res = await runDataHubInterfaceTestFetch(profile);
      if (res.ok && res.body.trim() && profile.jsonCleaningMode === "script") {
        const spec = parseScriptCleaningSpec(profile.jsonCleaningScriptSpec);
        if (spec) {
          const cleaned = runGroupBranchWorkshopDateCleaning(res.body, spec);
          if (cleaned.ok) {
            try {
              sessionStorage.setItem(DATA_HUB_CLEANED_JSON_PREFIX + profile.id, cleaned.text);
            } catch {
              /* quota */
            }
          }
        }
      }
      setTick((n) => n + 1);
      reloadHubState();
      if (!res.ok) {
        const extra = res.httpStatus != null ? `（HTTP ${res.httpStatus}）` : "";
        setRefreshError((res.error ?? "请求失败") + extra);
      }
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, [profileId, profiles, reloadHubState]);

  const lastExternalRefreshNonceRef = useRef(0);
  /** 报告提取「保存并更新现有任务进度」联动：须等 profile 就绪后再拉取，且勿在早退时消费 nonce（否则永不重试）。 */
  useEffect(() => {
    const n = refreshNonce;
    if (n <= 0 || n <= lastExternalRefreshNonceRef.current) return;
    if (!profileId.trim() || profiles.length === 0) return;

    lastExternalRefreshNonceRef.current = n;
    void handleRefreshData();
  }, [refreshNonce, profileId, profiles.length, handleRefreshData]);

  return (
    <section className="card report-tab-panel report-daily-list-panel">
      <div className="card-head report-daily-list-head report-daily-list-head--toolbar-only">
        <div className="report-daily-list-toolbar">
          <button
            type="button"
            className="ghost-btn tiny-btn"
            disabled={refreshing || profiles.length === 0}
            onClick={() => void handleRefreshData()}
          >
            {refreshing ? "刷新中…" : "刷新数据"}
          </button>
          {refreshError ? <span className="report-daily-list-refresh-error">{refreshError}</span> : null}
        </div>
      </div>

      {profiles.length === 0 && (
        <p className="muted small report-daily-list-hint">尚未配置数据中台接口。请先到「数据中台」添加数据源与接口。</p>
      )}

      {profileId && !cachedBody && !refreshing && (
        <p className="muted small report-daily-list-hint">
          当前接口暂无会话缓存。可点击「刷新数据」在线拉取（等同「数据中台 → 发送测试请求」写入原始响应）；拉取后本列表与「数据中台 → 数据列表 → 业务数据」使用相同解析与关键字筛选（在数据中台修改关键字后会自动同步）。
        </p>
      )}

      {profileId && cachedBody && !hubShapeOk && (
        <p className="muted small report-daily-list-hint warn">
          响应 JSON 形态不是典型的 `data.list` 列表；若列表为空，请确认接口返回结构与数据中台解析一致。
        </p>
      )}

      <div className="report-daily-list-filters">
        <span className="report-daily-list-filters-title">精确查询</span>
        <div className="report-daily-list-filters-grid report-daily-list-filters-grid--compact">
          <label className="report-daily-list-filter-item">
            <span>分公司/职能部门</span>
            <select
              className="fld report-daily-list-filter-select"
              value={filters.branchFunctional}
              onChange={(e) => setFilters((f) => ({ ...f, branchFunctional: e.target.value }))}
              aria-label="按分公司或职能部门筛选"
            >
              <option value="">全部</option>
              {branchOptions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="report-daily-list-filter-item">
            <span>部门/车间</span>
            <select
              className="fld report-daily-list-filter-select"
              value={filters.deptWorkshop}
              onChange={(e) => setFilters((f) => ({ ...f, deptWorkshop: e.target.value }))}
              aria-label="按部门或车间筛选"
            >
              <option value="">全部</option>
              {deptOptions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="report-daily-list-filter-item">
            <span>提交人</span>
            <input
              type="text"
              className="fld"
              value={filters.submitter}
              onChange={(e) => setFilters((f) => ({ ...f, submitter: e.target.value }))}
              placeholder="输入提交人姓名，模糊匹配"
            />
          </label>
          <label className="report-daily-list-filter-item">
            <span>日报日期</span>
            <input
              type="date"
              className="fld report-daily-list-date-input"
              value={filters.reportDateIso}
              title="留空表示不按日期筛选（查看全部）。点选或 Tab 聚焦本框且当前为空时，自动填入今天以便在日历中改选。"
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                flushSync(() => {
                  setFilters((f) => seedReportDateTodayIfEmpty(f));
                });
              }}
              onFocus={() => {
                setFilters((f) => seedReportDateTodayIfEmpty(f));
              }}
              onChange={(e) => setFilters((f) => ({ ...f, reportDateIso: e.target.value }))}
              aria-label="按日报日期筛选"
            />
          </label>
        </div>
        <div className="report-daily-list-filter-actions">
          <button type="button" className="ghost-btn tiny-btn" onClick={() => setFilters(emptyFilters())}>
            清空条件
          </button>
          <button
            type="button"
            className="ghost-btn tiny-btn"
            onClick={() => setFilters((f) => ({ ...f, reportDateIso: localIsoDate() }))}
          >
            日期设为今天
          </button>
        </div>
      </div>

      <div className="report-daily-list-table-wrap">
        <table className="report-daily-list-table">
          <thead>
            <tr>
              <th>分公司/职能部门</th>
              <th>部门/车间</th>
              <th>提交人</th>
              <th>日报日期</th>
              <th>日报详情</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="report-daily-list-empty-cell">
                  {profileId && cachedBody ? "无匹配数据（可调整查询条件）。" : "暂无数据。"}
                </td>
              </tr>
            ) : (
              filteredRows.map((r, i) => (
                <tr key={`${r.sortMs}-${r.reportDate}-${r.submitter}-${i}`}>
                  <td>{r.parentCompany || "—"}</td>
                  <td>{r.deptWorkshop || "—"}</td>
                  <td>{r.submitter || "—"}</td>
                  <td>{r.reportDate || "—"}</td>
                  <td>
                    {r.reportDetail.trim() ? (
                      <button
                        type="button"
                        className="report-daily-list-detail-btn"
                        onClick={() =>
                          setDetailDrawer({ text: r.reportDetail, rowKey: makeDailyRowKey(r) })
                        }
                      >
                        {previewDetail(r.reportDetail)}
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {filteredRows.length > 0 && (
        <p className="muted tiny report-daily-list-foot">共 {filteredRows.length} 条（已按创建时间降序；与数据中台字段一致时排序更准确）</p>
      )}

      {detailDrawer ? (
        <div
          className="data-sync-drawer-backdrop"
          role="presentation"
          onClick={() => setDetailDrawer(null)}
        >
          <aside
            className="data-sync-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-daily-detail-drawer-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="data-sync-drawer-head">
              <h2 id="report-daily-detail-drawer-title" className="data-sync-drawer-title">
                日报详情
              </h2>
              <button
                type="button"
                className="data-sync-drawer-close ghost-btn tiny-btn"
                onClick={() => setDetailDrawer(null)}
                aria-label="关闭"
              >
                关闭
              </button>
            </div>
            <div className="data-sync-drawer-body">
              <pre
                ref={detailPreRef}
                className="data-sync-drawer-pre report-daily-detail-pre-selectable"
              >
                {detailDrawer.text
                  ? buildDetailPreChildren(detailDrawer.text, drawerHighlightSpans)
                  : "（空）"}
              </pre>
            </div>
            {onAddToTopic ? (
              <div className="data-sync-drawer-footer">
                <button
                  type="button"
                  className="primary-btn tiny-btn"
                  onClick={() => {
                    const full = detailDrawer.text;
                    const fullLen = full.length;
                    const preEl = detailPreRef.current;
                    let start = 0;
                    let end = fullLen;
                    if (preEl) {
                      const range = getPlainTextRangeWithinElement(preEl);
                      if (range && range.end > range.start) {
                        start = range.start;
                        end = range.end;
                      } else {
                        const rawSel = window.getSelection()?.toString() ?? "";
                        if (rawSel.trim().length > 0) {
                          const idx = full.indexOf(rawSel);
                          if (idx < 0) {
                            window.alert("无法在正文中定位到当前选区，请直接在详情内拖选文字后再试。");
                            return;
                          }
                          start = idx;
                          end = idx + rawSel.length;
                        }
                      }
                    }
                    const excerpt = full.slice(start, end).trim();
                    if (!excerpt) {
                      window.alert("请先选中一段正文，或确保详情内容非空。");
                      return;
                    }
                    onAddToTopic({
                      excerpt,
                      rowKey: detailDrawer.rowKey,
                      start,
                      end,
                      fullTextLen: fullLen,
                    });
                    setDetailDrawer(null);
                  }}
                >
                  添加至议题
                </button>
                <span className="muted tiny">可选中部分正文后再点；未选中则使用全文。保存议题后此处会以黄色标记已添加片段。</span>
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}
    </section>
  );
}
