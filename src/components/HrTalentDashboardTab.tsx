/**
 * @fileoverview 数据看板「人事看板」：人才池 KPI、分布图、岗位薪资分析、可检索表格。
 *
 * @module components/HrTalentDashboardTab
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Donut } from "./Donut";
import { loadDataHubState } from "../utils/externalApiStorage";
import { loadDataSyncLastBody } from "../utils/dataSyncResponseStorage";
import {
  buildPositionSalaryBandSeries,
  COL_EMAIL_HINTS,
  COL_GENDER_HINTS,
  COL_LEVEL_HINTS,
  COL_NAME_HINTS,
  COL_PHONE_HINTS,
  COL_POSITION_HINTS,
  COL_REASON_HINTS,
  COL_SALARY_HINTS,
  COL_STATUS_HINTS,
  COL_TALENT_CREATE_DATE_HINTS,
  fetchTalentPoolRaw,
  formatTalentCreateDateDisplay,
  findTalentPoolProfile,
  parseTalentPoolRows,
  resolveColumnByHints,
  SALARY_DISTRIBUTION_BANDS,
} from "../utils/hrTalentPool";

const PAGE_SIZE = 18;
const POSITION_BAR_TOP = 10;
const POSITION_SALARY_TOP = 12;

const SALARY_BAND_COLORS = ["#94a3b8", "#60a5fa", "#34d399", "#fbbf24", "#f97316", "#cbd5e1"];

function countByColumn(rows: Record<string, string>[], col: string | null): { label: string; value: number }[] {
  if (!col) return [];
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = String(r[col] ?? "").trim() || "（空）";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function toDonutSegments(counts: { label: string; value: number }[], colors: string[]) {
  return counts.slice(0, 12).map((c, i) => ({
    label: c.label,
    value: c.value,
    color: colors[i % colors.length]!,
  }));
}

const DONUT_COLORS = ["#0d9f6e", "#1d6bc6", "#ea580c", "#c2410c", "#dc2626", "#7c3aed", "#0891b2", "#4d7c0f"];

/**
 * 各岗位月薪分档堆叠条 + 图例。
 */
function PositionSalaryAnalysisCard({
  series,
  positionCol,
  salaryCol,
}: {
  series: { position: string; bandCounts: number[]; nRows: number; nParsed: number }[];
  positionCol: string | null;
  salaryCol: string | null;
}) {
  if (!positionCol || !salaryCol) {
    return (
      <div className="card hr-salary-card">
        <div className="card-head tight">
          <h3>岗位薪资分析</h3>
        </div>
        <p className="muted small hr-salary-empty">未识别到「期望职位」或「期望薪资」列，无法按岗位汇总薪资档。</p>
      </div>
    );
  }

  const hasRows = series.some((s) => s.nRows > 0);
  if (!hasRows) {
    return (
      <div className="card hr-salary-card">
        <div className="card-head tight">
          <h3>岗位薪资分析</h3>
        </div>
        <p className="muted small hr-salary-empty">暂无岗位数据。</p>
      </div>
    );
  }

  return (
    <div className="card hr-salary-card">
      <div className="card-head tight">
        <div>
          <h3>岗位薪资分析</h3>
          <p className="muted tiny">
            每种岗位的薪资分布（分档） · 列「{positionCol}」×「{salaryCol}」
          </p>
        </div>
      </div>
      <div className="hr-salary-legend muted tiny">
        {SALARY_DISTRIBUTION_BANDS.map((lb, i) => (
          <span key={lb} className="hr-salary-legend-item">
            <i className="dot" style={{ background: SALARY_BAND_COLORS[i] }} />
            {lb}
          </span>
        ))}
      </div>
      <div className="hr-salary-rows">
        {series.map((row) => (
          <div key={row.position} className="hr-salary-row">
            <div className="hr-salary-row-title" title={row.position}>
              {row.position}
            </div>
            <div
              className="hr-salary-stack-track"
              title={`${row.nParsed}/${row.nRows} 条解析到月薪区间`}
              role="img"
              aria-label={`${row.position} 薪资分布`}
            >
              {row.bandCounts.map((c, i) =>
                c > 0 ? (
                  <div
                    key={`${row.position}-${i}`}
                    className="hr-salary-stack-seg"
                    style={{
                      flex: c,
                      background: SALARY_BAND_COLORS[i],
                    }}
                    title={`${SALARY_DISTRIBUTION_BANDS[i]}：${c} 人`}
                  />
                ) : null,
              )}
            </div>
            <div className="hr-salary-row-meta muted tiny">{row.nRows} 人</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 人才池列表固定列顺序（表头为中文业务名）。 */
const TABLE_FIELDS: { label: string; hints: RegExp[] }[] = [
  { label: "姓名", hints: COL_NAME_HINTS },
  { label: "性别", hints: COL_GENDER_HINTS },
  { label: "期望职位", hints: COL_POSITION_HINTS },
  { label: "推荐理由", hints: COL_REASON_HINTS },
  { label: "邮箱", hints: COL_EMAIL_HINTS },
  { label: "电话", hints: COL_PHONE_HINTS },
  { label: "期望薪资", hints: COL_SALARY_HINTS },
  { label: "状态", hints: COL_STATUS_HINTS },
  { label: "推荐等级", hints: COL_LEVEL_HINTS },
  { label: "创建时间", hints: COL_TALENT_CREATE_DATE_HINTS },
];

/** 人事看板主体：绑定数据中台「人才库」缓存/刷新，展示指标与列表。 */
export function HrTalentDashboardTab() {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string>("");
  const [platformName, setPlatformName] = useState<string>("");
  const [matchError, setMatchError] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSource, setLastSource] = useState<"cache" | "fetch" | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  const statusCol = useMemo(() => resolveColumnByHints(columns, COL_STATUS_HINTS), [columns]);
  const positionCol = useMemo(() => resolveColumnByHints(columns, COL_POSITION_HINTS), [columns]);
  const salaryCol = useMemo(() => resolveColumnByHints(columns, COL_SALARY_HINTS), [columns]);
  const levelCol = useMemo(() => resolveColumnByHints(columns, COL_LEVEL_HINTS), [columns]);
  const genderCol = useMemo(() => resolveColumnByHints(columns, COL_GENDER_HINTS), [columns]);
  const nameCol = useMemo(() => resolveColumnByHints(columns, COL_NAME_HINTS), [columns]);
  const createDateCol = useMemo(() => resolveColumnByHints(columns, COL_TALENT_CREATE_DATE_HINTS), [columns]);

  const applyParsed = useCallback((body: string, source: "cache" | "fetch") => {
    const parsed = parseTalentPoolRows(body);
    if (parsed.parseError) {
      setParseError(parsed.parseError);
      setRows([]);
      setColumns([]);
      setLastSource(source);
      return;
    }
    setParseError(null);
    setRows(parsed.rows);
    setColumns(parsed.columns);
    setLastSource(source);
  }, []);

  const loadFromCache = useCallback(() => {
    const { platforms, profiles } = loadDataHubState();
    const p = findTalentPoolProfile(platforms, profiles);
    if (!p) {
      setMatchError("未找到「齐峰协同办公平台」下名称含「人才库」的接口，请先在「数据中台」配置并保存。");
      setProfileId(null);
      setRows([]);
      setColumns([]);
      return;
    }
    setMatchError(null);
    setProfileId(p.id);
    setProfileName(p.name);
    const pl = platforms.find((x) => x.id === p.platformId);
    setPlatformName(pl?.name ?? "");
    const body = loadDataSyncLastBody(p.id);
    if (!body?.trim()) {
      setParseError(null);
      setRows([]);
      setColumns([]);
      return;
    }
    applyParsed(body, "cache");
  }, [applyParsed]);

  useEffect(() => {
    loadFromCache();
  }, [loadFromCache]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(q)));
  }, [rows, search]);

  const sortedRows = useMemo(() => {
    if (!sortKey) return filteredRows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filteredRows].sort((a, b) => {
      const va = String(a[sortKey] ?? "");
      const vb = String(b[sortKey] ?? "");
      const n = va.localeCompare(vb, "zh");
      return n * dir;
    });
  }, [filteredRows, sortKey, sortDir]);

  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return sortedRows.slice(start, start + PAGE_SIZE);
  }, [sortedRows, page]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [search, rows.length, sortKey]);

  const statusCounts = useMemo(() => countByColumn(rows, statusCol), [rows, statusCol]);
  const levelCounts = useMemo(() => countByColumn(rows, levelCol), [rows, levelCol]);
  const genderCounts = useMemo(() => countByColumn(rows, genderCol), [rows, genderCol]);
  const positionBars = useMemo(() => {
    const c = countByColumn(rows, positionCol);
    return c.slice(0, POSITION_BAR_TOP);
  }, [rows, positionCol]);

  const positionSalarySeries = useMemo(
    () => buildPositionSalaryBandSeries(rows, positionCol, salaryCol, POSITION_SALARY_TOP),
    [rows, positionCol, salaryCol],
  );

  const tableColumns = useMemo(
    () =>
      TABLE_FIELDS.map((f) => ({
        label: f.label,
        col: resolveColumnByHints(columns, f.hints),
      })),
    [columns],
  );

  const handleRefresh = async () => {
    const { platforms, profiles } = loadDataHubState();
    const p = findTalentPoolProfile(platforms, profiles);
    if (!p) {
      setMatchError("未找到人才库接口配置。");
      return;
    }
    setProfileId(p.id);
    setProfileName(p.name);
    const pl = platforms.find((x) => x.id === p.platformId);
    setPlatformName(pl?.name ?? "");
    setRefreshing(true);
    setRefreshError(null);
    const res = await fetchTalentPoolRaw(p);
    setRefreshing(false);
    if (!res.ok) {
      setRefreshError(res.error ?? "请求失败");
      if (res.body) applyParsed(res.body, "fetch");
      return;
    }
    applyParsed(res.body, "fetch");
  };

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return (
    <div className="hr-talent-dashboard">
      <div className="hr-talent-toolbar card">
        <div className="hr-talent-toolbar-text">
          <h2 className="hr-talent-title">人事看板 · 人才池</h2>
          <p className="muted small">
            数据源：{platformName ? `${platformName} · ` : ""}
            {profileName || "（未匹配接口）"}
            {profileId ? (
              <span className="muted tiny">
                {" "}
                · 最近来源：{lastSource === "fetch" ? "在线刷新" : lastSource === "cache" ? "会话缓存" : "—"}
              </span>
            ) : null}
          </p>
          {matchError ? <p className="report-hint">{matchError}</p> : null}
          {parseError ? <p className="report-hint">{parseError}</p> : null}
          {refreshError ? <p className="report-hint">{refreshError}</p> : null}
        </div>
        <div className="hr-talent-toolbar-actions">
          <button type="button" className="primary-btn" disabled={refreshing} onClick={() => void handleRefresh()}>
            {refreshing ? "刷新中…" : "刷新数据"}
          </button>
        </div>
      </div>

      <div className="hr-talent-body">
        <div className="hr-talent-main">
          <div className="hr-talent-donuts-row">
            {statusCol && statusCounts.length > 0 ? (
              <div className="card hr-talent-chart-card">
                <div className="card-head tight">
                  <h3>状态分布</h3>
                </div>
                <Donut segments={toDonutSegments(statusCounts, DONUT_COLORS)} size={112} />
              </div>
            ) : null}
            {levelCol && levelCounts.length > 0 ? (
              <div className="card hr-talent-chart-card">
                <div className="card-head tight">
                  <h3>推荐等级</h3>
                </div>
                <Donut segments={toDonutSegments(levelCounts, DONUT_COLORS)} size={112} />
              </div>
            ) : null}
            {genderCol && genderCounts.length > 0 ? (
              <div className="card hr-talent-chart-card">
                <div className="card-head tight">
                  <h3>性别结构</h3>
                </div>
                <Donut segments={toDonutSegments(genderCounts, DONUT_COLORS)} size={112} />
              </div>
            ) : null}
          </div>

          <PositionSalaryAnalysisCard series={positionSalarySeries} positionCol={positionCol} salaryCol={salaryCol} />
        </div>

        <aside className="hr-talent-aside" aria-label="人事指标与岗位分布">
          <div className="kpi-grid hr-talent-kpi-stack">
            <div className="kpi-card kpi-blue">
              <div className="kpi-title">人才池总人数</div>
              <div className="kpi-value">{rows.length}</div>
              <div className="kpi-meta muted tiny">当前解析行数</div>
            </div>
          </div>

          {positionBars.length > 0 ? (
            <section className="card hr-position-bars-card">
              <div className="card-head tight">
                <h3>简历库岗位分布</h3>
                <span className="muted tiny">Top {POSITION_BAR_TOP}</span>
              </div>
              <div className="hr-position-bars">
                {positionBars.map((b) => {
                  const max = positionBars[0]?.value || 1;
                  const pct = Math.round((b.value / max) * 100);
                  return (
                    <div key={b.label} className="hr-position-bar-row">
                      <div className="hr-position-bar-label" title={b.label}>
                        {b.label}
                      </div>
                      <div className="hr-position-bar-track">
                        <div className="hr-position-bar-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="hr-position-bar-val">{b.value}</div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
        </aside>
      </div>

      <section className="card hr-talent-table-card">
        <div className="card-head">
          <h3>人才池列表</h3>
          <div className="hr-talent-table-filters">
            <input
              className="fld"
              type="search"
              placeholder="搜索姓名、职位、推荐理由、邮箱、电话…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="筛选人才池"
            />
            <span className="muted tiny">
              共 {sortedRows.length} 条 · 第 {page}/{totalPages} 页
            </span>
          </div>
        </div>
        {!columns.length ? (
          <p className="muted small" style={{ padding: "12px 16px" }}>
            暂无表格数据。请先在「数据中台」选中「获取人才库」接口并点击<strong>测试</strong>，再回到此处；或点击「刷新数据」在线拉取（需接口允许浏览器直连）。
          </p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table hr-talent-table">
                <thead>
                  <tr>
                    {tableColumns.map(({ label, col }) => (
                      <th key={label}>
                        {col ? (
                          <button type="button" className="hr-th-sort" onClick={() => toggleSort(col)}>
                            {label}
                            {sortKey === col ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                          </button>
                        ) : (
                          <span className="hr-th-static">{label}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r, idx) => (
                    <tr key={`${(page - 1) * PAGE_SIZE + idx}-${r[nameCol ?? ""] ?? idx}`}>
                      {tableColumns.map(({ label, col }) => (
                        <td key={label} className="task-text-wrap muted tiny">
                          {!col
                            ? "—"
                            : col === createDateCol
                              ? formatTalentCreateDateDisplay(String(r[col] ?? ""))
                              : (r[col] ?? "—")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 ? (
              <div className="hr-talent-pager">
                <button type="button" className="ghost-btn tiny-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  上一页
                </button>
                <button
                  type="button"
                  className="ghost-btn tiny-btn"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
