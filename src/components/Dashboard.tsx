/**
 * @fileoverview 首页看板：任务维度（按当前视角、风险、环形图）与报告维度（`ReportDashboardTab`）；报告 Tab 切换时刷新 `loadExtractionHistory`。
 *
 * @module Dashboard
 */

import { useEffect, useMemo, useState } from "react";
import { TASK_CATEGORY_LEVEL1_LIST } from "../data/taskCategories";
import { useTasks } from "../context/TaskContext";
import { extractionHistoryVisibleForPerspective } from "../utils/leaderPerspective";
import { loadExtractionHistory } from "../utils/extractionHistoryStorage";
import { riskForTask, riskLabel } from "../utils/risk";
import { isIsoDateString } from "../utils/taskDueDate";
import { Donut } from "./Donut";
import { PendingArrangementSection } from "./PendingArrangementSection";
import { ReportDashboardTab } from "./ReportDashboardTab";

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function inMonth(isoDate: string, key: string) {
  return isoDate.slice(0, 7) === key;
}

const CATEGORY_META: Record<string, { title: string; subtitle: string }> = {
  "安全环保管控类 (HSE)": { title: "安全环保管控", subtitle: "隐患整改、违章纠偏、季节性防御与合规核查" },
  "生产能效对标类 (Production)": { title: "生产能效对标", subtitle: "产量、单耗、损纸消纳与成本分析" },
  "质量专项攻坚类 (Quality)": { title: "质量专项攻坚", subtitle: "纸病、工艺指标、客户反馈与新品试验" },
  "设备本质安全类 (Maintenance)": { title: "设备本质安全", subtitle: "维保、技改、备件资产与外部干扰防护" },
  "管理作风与赋能类 (Management)": { title: "管理作风与赋能", subtitle: "标准闭环、技能培训与精益标准化" },
};

type HomeBoardTab = "tasks" | "reports";

/** 默认落地页「看板」；任务与报告双 Tab。 */
export function Dashboard() {
  const { visibleTasks, toggleFollow, user } = useTasks();
  const [homeBoardTab, setHomeBoardTab] = useState<HomeBoardTab>("tasks");
  const [reportHistory, setReportHistory] = useState(() => loadExtractionHistory());
  const [reportMonth, setReportMonth] = useState(() => monthKey(new Date()));

  useEffect(() => {
    setReportHistory(loadExtractionHistory());
  }, [homeBoardTab]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setReportHistory(loadExtractionHistory());
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const filteredReportHistory = useMemo(
    () => reportHistory.filter((h) => extractionHistoryVisibleForPerspective(h, user.perspective)),
    [reportHistory, user.perspective],
  );

  const kpis = useMemo(() => {
    const total = visibleTasks.length;
    const done = visibleTasks.filter((t) => t.status === "已完成").length;
    const going = visibleTasks.filter((t) => t.status === "进行中").length;
    const nodes = visibleTasks.filter((t) => inMonth(t.expectedCompletion, reportMonth));
    const nodesDone = nodes.filter((t) => t.status === "已完成").length;
    const today = new Date();
    const delayed = nodes.filter(
      (t) =>
        t.status !== "已完成" &&
        isIsoDateString(t.expectedCompletion) &&
        new Date(t.expectedCompletion) < today,
    ).length;
    return { total, done, going, nodes: nodes.length, nodesDone, delayed };
  }, [visibleTasks, reportMonth]);

  const riskBuckets = useMemo(() => {
    let high = 0;
    let medium = 0;
    let low = 0;
    const today = new Date();
    for (const t of visibleTasks) {
      const r = riskForTask(t, today);
      if (r === "high") high += 1;
      else if (r === "medium") medium += 1;
      else low += 1;
    }
    return { high, medium, low };
  }, [visibleTasks]);

  const riskRows = useMemo(() => {
    const today = new Date();
    return [...visibleTasks]
      .filter((t) => riskForTask(t, today) !== "low")
      .sort((a, b) => a.expectedCompletion.localeCompare(b.expectedCompletion))
      .slice(0, 6);
  }, [visibleTasks]);

  const pendingList = useMemo(() => {
    const key = monthKey(new Date());
    return visibleTasks.filter((t) => {
      if (t.status === "已完成") return false;
      const due = t.expectedCompletion;
      if (inMonth(due, key)) return true;
      return isIsoDateString(due) && due < `${key}-01`;
    });
  }, [visibleTasks]);

  const following = useMemo(() => visibleTasks.filter((t) => t.followedByUser), [visibleTasks]);

  const byCategory = (cat: string) => {
    const subset = visibleTasks.filter((t) => t.categoryLevel1 === cat);
    const completed = subset.filter((t) => t.status === "已完成").length;
    const solid = subset.filter((t) => t.status === "实质性进展").length;
    const ongoing = subset.filter((t) => t.status === "进行中").length;
    const stuck = subset.filter((t) => t.status === "卡住待协调").length;
    return { subset, completed, solid, ongoing, stuck };
  };

  return (
    <div className="home-dash">
      <div className="report-main-tabs home-dash-subtabs" role="tablist" aria-label="数据看板分类">
        <button
          type="button"
          role="tab"
          aria-selected={homeBoardTab === "tasks"}
          className={`report-main-tab${homeBoardTab === "tasks" ? " is-active" : ""}`}
          onClick={() => setHomeBoardTab("tasks")}
        >
          任务看板
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={homeBoardTab === "reports"}
          className={`report-main-tab${homeBoardTab === "reports" ? " is-active" : ""}`}
          onClick={() => setHomeBoardTab("reports")}
        >
          报告看板
        </button>
      </div>

      {homeBoardTab === "reports" ? (
        <ReportDashboardTab history={filteredReportHistory} perspective={user.perspective} />
      ) : (
        <div className="dashboard">
      <div className="dash-main">
        <section className="card kpi-section">
          <div className="card-head">
            <h2>重点任务总览</h2>
            <div className="filters">
              <input
                className="fld"
                type="month"
                value={reportMonth}
                onChange={(e) => setReportMonth(e.target.value)}
                aria-label="统计月份"
              />
            </div>
          </div>
          <div className="kpi-grid">
            <div className="kpi-card kpi-blue">
              <div className="kpi-title">任务总数</div>
              <div className="kpi-value">{kpis.total}</div>
              <div className="kpi-meta">
                <span>
                  <i className="dot g" /> 已完成 {kpis.done}
                </span>
                <span>
                  <i className="dot b" /> 进行中 {kpis.going}
                </span>
              </div>
            </div>
            <div className="kpi-card kpi-green">
              <div className="kpi-title">本月节点（按期待完成时间）</div>
              <div className="kpi-value">{kpis.nodes}</div>
              <div className="kpi-meta">
                <span>
                  <i className="dot g" /> 已完成 {kpis.nodesDone}
                </span>
                <span>
                  <i className="dot r" /> 已逾期 {kpis.delayed}
                </span>
                <span className="frac">
                  月度目标 {kpis.nodesDone}/{Math.max(kpis.nodes, 1)}
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="card risk-section">
          <div className="card-head">
            <h2>风险预警</h2>
            <a className="link-more" href="#">
              查看更多
            </a>
          </div>
          <div className="risk-lights">
            <div className="light red">
              <span className="siren" aria-hidden>
                !
              </span>
              <div>
                <div className="light-label">红灯（高）</div>
                <div className="light-count">
                  {riskBuckets.high} <small>项需立即督办</small>
                </div>
              </div>
            </div>
            <div className="light yellow">
              <span className="siren" aria-hidden>
                !
              </span>
              <div>
                <div className="light-label">黄灯（中）</div>
                <div className="light-count">
                  {riskBuckets.medium} <small>项临近截止</small>
                </div>
              </div>
            </div>
            <div className="light blue">
              <span className="siren" aria-hidden>
                i
              </span>
              <div>
                <div className="light-label">蓝灯（低）</div>
                <div className="light-count">
                  {riskBuckets.low} <small>项节奏正常</small>
                </div>
              </div>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>任务编号</th>
                  <th>发起部门</th>
                  <th>风险</th>
                  <th>任务动因</th>
                  <th>任务描述</th>
                  <th>期待完成</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {riskRows.map((t) => {
                  const r = riskForTask(t, new Date());
                  return (
                    <tr key={t.id}>
                      <td className="mono">{t.code}</td>
                      <td>{t.department}</td>
                      <td>
                        <span className={`pill risk-${r}`}>{riskLabel(r)}</span>
                      </td>
                      <td className="task-text-wrap muted tiny">{t.taskMotivation?.trim() || "—"}</td>
                      <td className="task-text-wrap">{t.description}</td>
                      <td>{t.expectedCompletion}</td>
                      <td>
                        <button type="button" className="text-btn" onClick={() => toggleFollow(t.id)}>
                          {t.followedByUser ? "取消关注" : "关注"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {riskRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="empty-cell">
                      当前视角下暂无中高风险任务。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <PendingArrangementSection
          perspective={user.perspective}
          extractionHistory={filteredReportHistory}
        />

        <section className="category-row">
          {TASK_CATEGORY_LEVEL1_LIST.map((cat) => {
            const meta = CATEGORY_META[cat] ?? { title: cat, subtitle: "" };
            const { subset, completed, solid, ongoing, stuck } = byCategory(cat);
            if (subset.length === 0) return null;
            return (
              <div key={cat} className="card cat-card">
                <div className="card-head tight">
                  <div>
                    <h3>{meta.title}</h3>
                    <p className="muted tiny">{meta.subtitle}</p>
                  </div>
                  <a className="link-more" href="#">
                    查看详情
                  </a>
                </div>
                <div className="cat-filters">
                  <span className="muted tiny">口径与总览卡片一致</span>
                </div>
                <div className="cat-stats">
                  <span>任务 {subset.length} 条</span>
                  <span className="muted tiny">
                    {subset[0]?.executingDepartment
                      ? `示例执行部门：${subset[0].executingDepartment}`
                      : ""}
                  </span>
                </div>
                <Donut
                  segments={[
                    { label: "已完成", value: completed, color: "#0d9f6e" },
                    { label: "实质性进展", value: solid, color: "#1d6bc6" },
                    { label: "进行中", value: ongoing, color: "#ea580c" },
                    { label: "卡住待协调", value: stuck, color: "#dc2626" },
                  ]}
                />
              </div>
            );
          })}
        </section>
      </div>

      <aside className="dash-side">
        <div className="card side-card">
          <div className="card-head tight">
            <h3>本月待完成事项</h3>
          </div>
          <ul className="side-list">
            {pendingList.slice(0, 8).map((t) => (
              <li key={t.id}>
                <span className="muted tiny">{t.expectedCompletion}</span>
                <div>
                  <strong>{t.executingDepartment || t.branch || "—"}</strong>
                  {t.workshop ? `（${t.workshop}）` : ""}：{t.description.slice(0, 36)}
                  {t.description.length > 36 ? "…" : ""}
                </div>
              </li>
            ))}
            {pendingList.length === 0 && <li className="muted">暂无待完成提醒。</li>}
          </ul>
        </div>
        <div className="card side-card">
          <div className="card-head tight">
            <h3>我的关注</h3>
          </div>
          <ul className="side-list star">
            {following.map((t) => (
              <li key={t.id}>
                <span className="star-icon" aria-hidden>
                  ★
                </span>
                <div>
                  <span className="mono tiny">{t.code}</span> — {t.description.slice(0, 42)}
                  {t.description.length > 42 ? "…" : ""}
                </div>
              </li>
            ))}
            {following.length === 0 && (
              <li className="muted">在任务列表或风险表中点击「关注」即可加入此处。</li>
            )}
          </ul>
        </div>
      </aside>
        </div>
      )}
    </div>
  );
}
