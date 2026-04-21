import { useEffect, useMemo, useRef, useState } from "react";
import { STATUSES, useTasks } from "../context/TaskContext";
import {
  getDefaultCategoryPair,
  level2NamesForLevel1,
  TASK_CATEGORY_LEVEL1_LIST,
} from "../data/taskCategories";
import type { PlanHistorySnapshot } from "../types/planHistory";
import { TaskStatusPill, taskDetailDrawerToolbarModifierClass } from "./TaskStatusPill";
import {
  COORDINATION_PARTY_OPTIONS,
  type Task,
  type TaskProgressEntry,
  type TaskStatus,
} from "../types/task";
import { formatReportCalendarDateZh } from "../utils/extractionHistoryGroup";
import {
  branchRootFromOrgPath,
  GROUP_LEADER_PERSPECTIVE,
  isBranchCompanyUnit,
  orgStructureContainsDepartment,
  orgUnitFromPerspective,
} from "../utils/leaderPerspective";
import { getOrgStructureLines, ORG_STRUCTURE_CHANGED_EVENT } from "../utils/orgStructureStorage";
import {
  loadPlanHistorySnapshots,
  markPlanHistoryRowsPendingPlan,
  planHistoryStatusLabel,
  PLAN_HISTORY_UPDATED_EVENT,
  restorePlanHistoryRowFromPendingPlan,
  restorePlanHistoryRowsFromPendingPlanBatch,
} from "../utils/planHistoryStorage";
import { isIsoDateString, PENDING_EXPECTED_COMPLETION } from "../utils/taskDueDate";
import { requestJumpToExtractionHistory } from "../utils/reportCitation";
import { TASK_OPEN_MANUAL_NEW_EVENT } from "../utils/assistantUiActions";

type TaskMgmtTab = "list" | "planHistory";

function planHistoryRowSelectKey(snapId: string, rowIndex: number) {
  return `${snapId}\t${rowIndex}`;
}

function parseReceiverDepartments(s: string): string[] | undefined {
  const parts = s
    .split(/[,，;；\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

function defaultExecutingDepartment(unit: string | null, orgLines: string[]): string {
  if (unit && isBranchCompanyUnit(unit)) return unit;
  if (unit) return unit;
  for (const l of orgLines) {
    const b = branchRootFromOrgPath(l);
    if (b) return b;
  }
  const branches = orgLines.filter((l) => isBranchCompanyUnit(l));
  if (branches[0]) return branches[0];
  return orgLines[0] ?? "";
}

function makeEmptyForm(perspective: string, orgLines: string[]) {
  const unit = orgUnitFromPerspective(perspective);
  const cat = getDefaultCategoryPair();
  return {
    initiator: "",
    department: unit ?? "",
    executingDepartment: defaultExecutingDepartment(unit, orgLines),
    categoryLevel1: cat.categoryLevel1,
    categoryLevel2: cat.categoryLevel2,
    taskMotivation: "",
    description: "",
    expectedCompletion: "",
    status: "进行中" as TaskStatus,
    coordinationParty: "",
    leaderInstruction: "",
    receiversStr: "",
  };
}

function branchWorkshopFromExecuting(executingDepartment: string): { branch: string; workshop: null } {
  const ed = executingDepartment.trim();
  if (ed && isBranchCompanyUnit(ed)) return { branch: ed, workshop: null };
  return { branch: "", workshop: null };
}

export function TaskManagement() {
  const { visibleTasks, addTask, removeTask, updateTask, toggleFollow, user } = useTasks();
  const [taskMgmtTab, setTaskMgmtTab] = useState<TaskMgmtTab>("list");
  const [planSnapshots, setPlanSnapshots] = useState<PlanHistorySnapshot[]>(() => loadPlanHistorySnapshots());
  const [orgEpoch, setOrgEpoch] = useState(0);
  const orgLines = useMemo(() => getOrgStructureLines(), [orgEpoch]);
  const [form, setForm] = useState(() => makeEmptyForm(user.perspective, orgLines));
  const [editing, setEditing] = useState<Task | null>(null);
  const [manualNewTaskOpen, setManualNewTaskOpen] = useState(false);
  const [manualNewTaskEntered, setManualNewTaskEntered] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [planHistorySelectedKeys, setPlanHistorySelectedKeys] = useState<string[]>([]);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [detailDrawerEntered, setDetailDrawerEntered] = useState(false);
  const taskListHeaderCheckboxRef = useRef<HTMLInputElement>(null);

  const detailTask = useMemo(
    () => (detailTaskId ? visibleTasks.find((t) => t.id === detailTaskId) : undefined),
    [detailTaskId, visibleTasks],
  );

  const sortedProgressEntries = useMemo((): TaskProgressEntry[] => {
    const raw = detailTask?.progressTracking;
    if (!raw?.length) return [];
    return [...raw].sort(
      (a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description),
    );
  }, [detailTask?.progressTracking]);

  const isGroupPerspective = user.perspective === GROUP_LEADER_PERSPECTIVE;
  const lockedInitiatorUnit = orgUnitFromPerspective(user.perspective);

  useEffect(() => {
    const bump = () => setOrgEpoch((n) => n + 1);
    window.addEventListener(ORG_STRUCTURE_CHANGED_EVENT, bump);
    return () => window.removeEventListener(ORG_STRUCTURE_CHANGED_EVENT, bump);
  }, []);

  useEffect(() => {
    const onAssistantOpenManual = () => {
      setTaskMgmtTab("list");
      setManualNewTaskOpen(true);
    };
    window.addEventListener(TASK_OPEN_MANUAL_NEW_EVENT, onAssistantOpenManual);
    return () => window.removeEventListener(TASK_OPEN_MANUAL_NEW_EVENT, onAssistantOpenManual);
  }, []);

  useEffect(() => {
    setForm(makeEmptyForm(user.perspective, getOrgStructureLines()));
  }, [user.perspective, orgEpoch]);

  useEffect(() => {
    const bump = () => setPlanSnapshots(loadPlanHistorySnapshots());
    window.addEventListener(PLAN_HISTORY_UPDATED_EVENT, bump);
    return () => window.removeEventListener(PLAN_HISTORY_UPDATED_EVENT, bump);
  }, []);

  useEffect(() => {
    if (taskMgmtTab === "planHistory") setPlanSnapshots(loadPlanHistorySnapshots());
  }, [taskMgmtTab]);

  useEffect(() => {
    if (taskMgmtTab !== "list") {
      setManualNewTaskOpen(false);
      setSelectedTaskIds([]);
      setDetailTaskId(null);
    }
    if (taskMgmtTab !== "planHistory") setPlanHistorySelectedKeys([]);
  }, [taskMgmtTab]);

  useEffect(() => {
    if (detailTaskId && !detailTask) setDetailTaskId(null);
  }, [detailTaskId, detailTask]);

  useEffect(() => {
    if (!detailTaskId) {
      setDetailDrawerEntered(false);
      return;
    }
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setDetailDrawerEntered(true));
    });
    return () => window.cancelAnimationFrame(id);
  }, [detailTaskId]);

  useEffect(() => {
    if (!detailTaskId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetailTaskId(null);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [detailTaskId]);

  useEffect(() => {
    setPlanHistorySelectedKeys((prev) =>
      prev.filter((key) => {
        const tab = key.indexOf("\t");
        if (tab < 0) return false;
        const snapId = key.slice(0, tab);
        const idx = Number(key.slice(tab + 1));
        const snap = planSnapshots.find((s) => s.id === snapId);
        if (!snap || !Number.isFinite(idx) || idx < 0 || idx >= snap.rows.length) return false;
        return planHistoryStatusLabel(snap.rows[idx]) === "待计划";
      }),
    );
  }, [planSnapshots]);

  const taskListHeaderChecked =
    visibleTasks.length > 0 && visibleTasks.every((t) => selectedTaskIds.includes(t.id));
  const taskListHeaderIndeterminate =
    visibleTasks.length > 0 &&
    selectedTaskIds.length > 0 &&
    visibleTasks.some((t) => selectedTaskIds.includes(t.id)) &&
    !taskListHeaderChecked;

  useEffect(() => {
    const el = taskListHeaderCheckboxRef.current;
    if (el) el.indeterminate = taskListHeaderIndeterminate;
  }, [taskListHeaderIndeterminate]);

  useEffect(() => {
    if (!manualNewTaskOpen) {
      setManualNewTaskEntered(false);
      return;
    }
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setManualNewTaskEntered(true));
    });
    return () => window.cancelAnimationFrame(id);
  }, [manualNewTaskOpen]);

  useEffect(() => {
    if (!manualNewTaskOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setManualNewTaskOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [manualNewTaskOpen]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.initiator.trim() || !form.description.trim()) {
      alert("请填写发起人与任务描述。");
      return;
    }
    if (isGroupPerspective && !form.department.trim()) {
      alert("请选择发起部门。");
      return;
    }
    if (!isGroupPerspective) {
      const u = lockedInitiatorUnit?.trim();
      if (!u || form.department.trim() !== u) {
        alert("发起部门须与当前视角一致。");
        return;
      }
    }
    const exec = form.executingDepartment.trim();
    if (!exec) {
      alert("请填写或选择执行部门。");
      return;
    }
    if (!isGroupPerspective) {
      if (!orgStructureContainsDepartment(orgLines, exec)) {
        alert("执行部门须为部门架构中的职能部门或分公司。");
        return;
      }
    }
    const dueRaw = form.expectedCompletion.trim();
    if (!dueRaw) {
      alert("请填写期待完成时间（YYYY-MM-DD）或「待定」。");
      return;
    }
    if (!isIsoDateString(dueRaw) && dueRaw !== PENDING_EXPECTED_COMPLETION) {
      alert("期待完成请填写 YYYY-MM-DD 或「待定」。");
      return;
    }
    if (form.status === "卡住待协调" && !form.coordinationParty?.trim()) {
      alert("处于「卡住待协调」时必须选择协调方。");
      return;
    }
    const receiverDepartments = parseReceiverDepartments(form.receiversStr);
    const { branch, workshop } = branchWorkshopFromExecuting(exec);
    addTask({
      initiator: form.initiator.trim(),
      department: form.department.trim(),
      executingDepartment: exec,
      categoryLevel1: form.categoryLevel1,
      categoryLevel2: form.categoryLevel2,
      taskMotivation: form.taskMotivation.trim(),
      description: form.description.trim(),
      expectedCompletion: dueRaw,
      status: form.status,
      branch,
      workshop,
      ...(form.status === "卡住待协调" && form.coordinationParty.trim()
        ? { coordinationParty: form.coordinationParty.trim() }
        : {}),
      ...(form.leaderInstruction?.trim()
        ? { leaderInstruction: form.leaderInstruction.trim() }
        : {}),
      ...(receiverDepartments ? { receiverDepartments } : {}),
    });
    setForm(makeEmptyForm(user.perspective, getOrgStructureLines()));
    setManualNewTaskOpen(false);
  }

  return (
    <div className="task-page">
      <div className="report-main-tabs task-mgmt-tabs" role="tablist" aria-label="任务管理分类">
        <button
          type="button"
          role="tab"
          aria-selected={taskMgmtTab === "list"}
          className={`report-main-tab${taskMgmtTab === "list" ? " is-active" : ""}`}
          onClick={() => setTaskMgmtTab("list")}
        >
          任务列表
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={taskMgmtTab === "planHistory"}
          className={`report-main-tab${taskMgmtTab === "planHistory" ? " is-active" : ""}`}
          onClick={() => setTaskMgmtTab("planHistory")}
        >
          计划历史
        </button>
      </div>

      {taskMgmtTab === "list" && (
        <>
      <section className="card">
        <div className="card-head task-list-card-head">
          <h2>任务列表（按权限过滤）</h2>
          <div className="task-list-bulk-actions">
            <button
              type="button"
              className="ghost-btn danger-outline manual-new-task-btn"
              disabled={selectedTaskIds.length === 0}
              onClick={() => {
                const n = selectedTaskIds.length;
                if (!n) return;
                if (!confirm(`确定删除选中的 ${n} 条任务？`)) return;
                for (const id of selectedTaskIds) {
                  const t = visibleTasks.find((x) => x.id === id);
                  if (!t) continue;
                  const src = t.sourcePendingDailyPlanRowId?.trim();
                  if (src) markPlanHistoryRowsPendingPlan(src);
                  removeTask(t.id);
                }
                setSelectedTaskIds([]);
              }}
            >
              批量删除
            </button>
            <button
              type="button"
              className="primary-btn manual-new-task-btn"
              onClick={() => {
                setDetailTaskId(null);
                setManualNewTaskOpen(true);
              }}
            >
              手工新建任务
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th className="task-table-col-check">
                  <input
                    ref={taskListHeaderCheckboxRef}
                    type="checkbox"
                    checked={taskListHeaderChecked}
                    disabled={visibleTasks.length === 0}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedTaskIds(visibleTasks.map((t) => t.id));
                      else setSelectedTaskIds([]);
                    }}
                    aria-label="全选当前列表任务"
                  />
                </th>
                <th>编号</th>
                <th>发起人</th>
                <th>发起部门</th>
                <th>执行部门</th>
                <th>接收/配合</th>
                <th>大类</th>
                <th>子类</th>
                <th>任务动因</th>
                <th>描述</th>
                <th>期待完成</th>
                <th>状态</th>
                <th>协调方</th>
                <th>进度跟踪</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibleTasks.map((t) => (
                <tr
                  key={t.id}
                  className={`task-table-data-row${detailTaskId === t.id ? " is-detail-open" : ""}`}
                  onClick={() => setDetailTaskId(t.id)}
                >
                  <td className="task-table-col-check" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedTaskIds.includes(t.id)}
                      onChange={() =>
                        setSelectedTaskIds((prev) =>
                          prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id],
                        )
                      }
                      aria-label={`选择任务 ${t.code}`}
                    />
                  </td>
                  <td className="mono">{t.code}</td>
                  <td>{t.initiator}</td>
                  <td>{t.department}</td>
                  <td className="muted tiny">{t.executingDepartment || "—"}</td>
                  <td className="muted tiny">
                    {(t.receiverDepartments?.length ? t.receiverDepartments.join("、") : t.receiverDepartment) || "—"}
                  </td>
                  <td className="muted tiny task-text-wrap">{t.categoryLevel1}</td>
                  <td className="muted tiny task-text-wrap">{t.categoryLevel2}</td>
                  <td className="task-text-wrap muted tiny">{t.taskMotivation?.trim() || "—"}</td>
                  <td className="task-text-wrap">{t.description}</td>
                  <td>{t.expectedCompletion}</td>
                  <td>
                    <TaskStatusPill status={t.status} />
                  </td>
                  <td className="muted tiny">
                    {t.status === "卡住待协调"
                      ? t.coordinationParty?.trim() || "—"
                      : "—"}
                  </td>
                  <td className="muted tiny">
                    {t.progressTracking?.length
                      ? `${t.progressTracking.length}条`
                      : "—"}
                  </td>
                  <td className="actions" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="text-btn" onClick={() => toggleFollow(t.id)}>
                      {t.followedByUser ? "已关注" : "关注"}
                    </button>
                    <button type="button" className="text-btn" onClick={() => setEditing(t)}>
                      编辑
                    </button>
                    <button
                      type="button"
                      className="text-btn danger"
                      onClick={() => {
                        if (!confirm("确定删除该任务？")) return;
                        const src = t.sourcePendingDailyPlanRowId?.trim();
                        if (src) markPlanHistoryRowsPendingPlan(src);
                        removeTask(t.id);
                        setSelectedTaskIds((prev) => prev.filter((x) => x !== t.id));
                      }}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {visibleTasks.length === 0 && (
                <tr>
                  <td colSpan={15} className="empty-cell">
                    当前视角下没有可见任务。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {detailTask && (
        <div className="task-detail-drawer-root">
          <div
            className={`task-detail-drawer-backdrop${detailDrawerEntered ? " is-visible" : ""}`}
            role="presentation"
            aria-hidden="true"
            onClick={() => setDetailTaskId(null)}
          />
          <aside
            className={`task-detail-drawer-panel${detailDrawerEntered ? " is-visible" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-detail-drawer-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={`task-detail-drawer-toolbar ${taskDetailDrawerToolbarModifierClass(detailTask.status)}`}
            >
              <h2 id="task-detail-drawer-title">{detailTask.status}</h2>
              <button
                type="button"
                className="task-detail-drawer-close"
                aria-label="关闭"
                onClick={() => setDetailTaskId(null)}
              >
                ×
              </button>
            </div>
            <div className="task-detail-drawer-body">
              <dl className="task-detail-dl">
                <div>
                  <dt>编号</dt>
                  <dd className="mono">{detailTask.code}</dd>
                </div>
                <div>
                  <dt>发起人</dt>
                  <dd>{detailTask.initiator}</dd>
                </div>
                <div>
                  <dt>发起部门</dt>
                  <dd>{detailTask.department}</dd>
                </div>
                <div>
                  <dt>执行部门</dt>
                  <dd className="muted tiny">{detailTask.executingDepartment || "—"}</dd>
                </div>
                <div>
                  <dt>接收/配合</dt>
                  <dd className="muted tiny">
                    {(detailTask.receiverDepartments?.length
                      ? detailTask.receiverDepartments.join("、")
                      : detailTask.receiverDepartment) || "—"}
                  </dd>
                </div>
                <div className="task-detail-dl-full">
                  <dt>任务大类</dt>
                  <dd className="task-text-wrap small">{detailTask.categoryLevel1}</dd>
                </div>
                <div className="task-detail-dl-full">
                  <dt>任务子类</dt>
                  <dd className="task-text-wrap small">{detailTask.categoryLevel2}</dd>
                </div>
                <div className="task-detail-dl-full">
                  <dt>任务动因</dt>
                  <dd className="task-detail-highlight-card task-text-wrap small">
                    {detailTask.taskMotivation?.trim() || "—"}
                  </dd>
                </div>
                <div className="task-detail-dl-full">
                  <dt>任务描述</dt>
                  <dd className="task-detail-highlight-card task-text-wrap">{detailTask.description}</dd>
                </div>
                <div className="task-detail-dl-full">
                  <dt>领导指示</dt>
                  <dd className="task-detail-leader-card task-text-wrap small">
                    {detailTask.leaderInstruction?.trim() || "—"}
                  </dd>
                </div>
                <div>
                  <dt>期待完成</dt>
                  <dd>{detailTask.expectedCompletion}</dd>
                </div>
                {detailTask.status === "卡住待协调" && (
                  <div>
                    <dt>协调方</dt>
                    <dd>{detailTask.coordinationParty?.trim() || "—"}</dd>
                  </div>
                )}
              </dl>
              <section className="task-detail-progress-section" aria-labelledby="task-detail-progress-heading">
                <h3 id="task-detail-progress-heading" className="task-detail-progress-heading">
                  进度跟踪
                </h3>
                {sortedProgressEntries.length === 0 ? (
                  <p className="muted small task-detail-progress-empty">
                    暂无进展记录；可在<strong>报告</strong>页「现有任务进度更新」中根据日报写入。
                  </p>
                ) : (
                  <ul className="task-detail-timeline" aria-label="进度时间线">
                    {sortedProgressEntries.map((row, idx) => (
                      <li key={`${row.date}-${idx}-${row.description.slice(0, 24)}`} className="task-detail-timeline-item">
                        <span className="task-detail-timeline-dot" aria-hidden="true">
                          ○
                        </span>
                        <div className="task-detail-timeline-main">
                          <div className="task-detail-timeline-date mono">{row.date}</div>
                          <div className="task-detail-timeline-desc">{row.description}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </aside>
        </div>
      )}

      {manualNewTaskOpen && (
        <div className="task-new-drawer-root">
          <div
            className={`task-new-drawer-backdrop${manualNewTaskEntered ? " is-visible" : ""}`}
            role="presentation"
            aria-hidden="true"
            onClick={() => setManualNewTaskOpen(false)}
          />
          <aside
            className={`task-new-drawer-panel${manualNewTaskEntered ? " is-visible" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="manual-new-task-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="task-new-drawer-toolbar">
              <h2 id="manual-new-task-title">手工新建任务</h2>
              <button
                type="button"
                className="task-new-drawer-close"
                aria-label="关闭"
                onClick={() => setManualNewTaskOpen(false)}
              >
                ×
              </button>
            </div>
            <p className="muted small task-new-drawer-hint">
              发起部门默认与当前视角一致（集团领导可在架构中任选）；执行部门为任务落地单位；总部职能部门可向其他部门或分公司派发。已不再单独填写分公司与车间。
            </p>
            <form className="task-form task-new-drawer-form" onSubmit={submit}>
              <label>
                发起人
                <input
                  value={form.initiator}
                  onChange={(e) => setForm({ ...form, initiator: e.target.value })}
                  placeholder="姓名"
                />
              </label>
              <label>
                发起部门
                {isGroupPerspective ? (
                  <select
                    value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })}
                    required
                  >
                    <option value="">请选择</option>
                    {orgLines.map((line) => (
                      <option key={line} value={line}>
                        {line}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input value={form.department} readOnly className="fld-readonly" title="与当前视角绑定" />
                )}
              </label>
              <label>
                执行部门
                {isGroupPerspective ? (
                  <input
                    value={form.executingDepartment}
                    onChange={(e) => setForm({ ...form, executingDepartment: e.target.value })}
                    placeholder="可填写任意部门或分公司名称"
                    list="task-exec-org-list"
                  />
                ) : (
                  <select
                    value={form.executingDepartment}
                    onChange={(e) => setForm({ ...form, executingDepartment: e.target.value })}
                    required
                  >
                    <option value="">请选择</option>
                    {orgLines.map((line) => (
                      <option key={line} value={line}>
                        {line}
                      </option>
                    ))}
                  </select>
                )}
                <datalist id="task-exec-org-list">
                  {orgLines.map((line) => (
                    <option key={line} value={line} />
                  ))}
                </datalist>
              </label>
              <label className="full">
                接收 / 配合部门（可选，逗号或顿号分隔）
                <input
                  value={form.receiversStr}
                  onChange={(e) => setForm({ ...form, receiversStr: e.target.value })}
                  placeholder="如：财务部，采购部"
                />
              </label>
              <label className="full">
                任务大类
                <select
                  value={form.categoryLevel1}
                  onChange={(e) => {
                    const l1 = e.target.value;
                    const l2opts = level2NamesForLevel1(l1);
                    setForm({
                      ...form,
                      categoryLevel1: l1,
                      categoryLevel2: l2opts.includes(form.categoryLevel2) ? form.categoryLevel2 : (l2opts[0] ?? ""),
                    });
                  }}
                >
                  {TASK_CATEGORY_LEVEL1_LIST.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="full">
                任务子类
                <select
                  value={form.categoryLevel2}
                  onChange={(e) => setForm({ ...form, categoryLevel2: e.target.value })}
                >
                  {level2NamesForLevel1(form.categoryLevel1).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="full">
                任务动因
                <textarea
                  rows={2}
                  value={form.taskMotivation}
                  onChange={(e) => setForm({ ...form, taskMotivation: e.target.value })}
                  placeholder="立项背景、触发原因或政策/事件依据（可选）"
                />
              </label>
              <label className="full">
                任务描述
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="目标、交付物、关键里程碑等"
                />
              </label>
              <label className="full">
                领导指示（可选，可由日报计划或进度更新写入）
                <textarea
                  rows={2}
                  value={form.leaderInstruction}
                  onChange={(e) => setForm({ ...form, leaderInstruction: e.target.value })}
                  placeholder="领导指示、批示或建议原文摘录"
                />
              </label>
              <label>
                期待完成时间
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="YYYY-MM-DD 或 待定"
                  value={form.expectedCompletion}
                  onChange={(e) => setForm({ ...form, expectedCompletion: e.target.value })}
                />
              </label>
              <label>
                状态
                <select
                  value={form.status}
                  onChange={(e) => {
                    const st = e.target.value as TaskStatus;
                    setForm((prev) =>
                      st === "卡住待协调"
                        ? {
                            ...prev,
                            status: st,
                            coordinationParty:
                              prev.coordinationParty?.trim() || COORDINATION_PARTY_OPTIONS[0],
                          }
                        : { ...prev, status: st, coordinationParty: "" },
                    );
                  }}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              {form.status === "卡住待协调" && (
                <label className="full">
                  协调方
                  <select
                    value={form.coordinationParty || COORDINATION_PARTY_OPTIONS[0]}
                    onChange={(e) => setForm({ ...form, coordinationParty: e.target.value })}
                    required
                  >
                    {COORDINATION_PARTY_OPTIONS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="form-actions full">
                <button type="button" className="ghost-btn" onClick={() => setManualNewTaskOpen(false)}>
                  取消
                </button>
                <button type="submit" className="primary-btn">
                  保存任务
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}

      {editing && (
        <div className="modal-backdrop" role="presentation" onClick={() => setEditing(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>编辑任务</h3>
            <EditForm
              key={editing.id}
              task={editing}
              perspective={user.perspective}
              orgLines={orgLines}
              onSave={(patch) => {
                updateTask(editing.id, patch);
                setEditing(null);
              }}
              onClose={() => setEditing(null)}
            />
          </div>
        </div>
      )}
        </>
      )}

      {taskMgmtTab === "planHistory" && (
        <section className="card plan-history-section">
          <div className="card-head">
            <h2>计划历史</h2>
          </div>
          <div className="plan-history-body muted small">
            <p>
              在<strong>数据看板 → 任务看板 → 待安排任务</strong>中，每成功生成一条日报计划任务，即在此处追加一条记录（含任务形成日期、任务计划角色）；批量生成全部成功结束后仅弹出提示，不再整表写入。
            </p>
            <p>
              在<strong>任务列表</strong>中删除由日报计划生成的任务时，对应计划历史行会标为<strong>待计划</strong>，看板该行的「生成任务」不会立即恢复；请在下方勾选<strong>待计划</strong>记录后<strong>批量返回计划</strong>，或逐条点击<strong>返回计划</strong>，记录将从计划历史中移除，再到看板生成任务。
            </p>
            <p>
              日报解析与保存仍在<strong>报告</strong>；本 Tab 不展示报告提取历史的正文 / JSON / 时间线。
            </p>
          </div>
          {planSnapshots.length === 0 ? (
            <p className="muted small">暂无计划历史记录；请在看板对日报计划执行「生成任务」或「批量生成任务」。</p>
          ) : (
            <>
              <div className="plan-history-bulk-bar">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    const keys: string[] = [];
                    for (const snap of planSnapshots) {
                      snap.rows.forEach((row, idx) => {
                        if (planHistoryStatusLabel(row) === "待计划") {
                          keys.push(planHistoryRowSelectKey(snap.id, idx));
                        }
                      });
                    }
                    setPlanHistorySelectedKeys(keys);
                  }}
                >
                  全选待计划
                </button>
                <button
                  type="button"
                  className="primary-btn"
                  disabled={planHistorySelectedKeys.length === 0}
                  onClick={() => {
                    const idSet = new Set<string>();
                    for (const key of planHistorySelectedKeys) {
                      const tab = key.indexOf("\t");
                      if (tab < 0) continue;
                      const snapId = key.slice(0, tab);
                      const idx = Number(key.slice(tab + 1));
                      const snap = planSnapshots.find((s) => s.id === snapId);
                      if (!snap || !Number.isFinite(idx) || idx < 0 || idx >= snap.rows.length) continue;
                      const row = snap.rows[idx];
                      if (planHistoryStatusLabel(row) === "待计划") idSet.add(row.id);
                    }
                    const n = idSet.size;
                    if (!n) {
                      alert("请先勾选状态为「待计划」的记录。");
                      return;
                    }
                    if (!confirm(`确定将选中的 ${n} 条待计划记录返回看板？对应条目将从计划历史中移除。`)) return;
                    restorePlanHistoryRowsFromPendingPlanBatch([...idSet]);
                    setPlanHistorySelectedKeys([]);
                  }}
                >
                  批量返回计划
                </button>
                {planHistorySelectedKeys.length > 0 && (
                  <button type="button" className="ghost-btn" onClick={() => setPlanHistorySelectedKeys([])}>
                    清除选择
                  </button>
                )}
              </div>
            <div className="plan-history-snapshots">
              {planSnapshots.map((snap) => (
                <article key={snap.id} className="plan-history-snapshot-card">
                  <p className="plan-history-snapshot-meta">
                    写入时间{" "}
                    {new Date(snap.createdAt).toLocaleString("zh-CN", {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    <span className="muted"> · </span>
                    视角 {snap.perspectiveWhenSaved}
                  </p>
                  <div className="table-wrap plan-history-snapshot-table-wrap">
                    <table className="data-table plan-history-snapshot-table">
                      <thead>
                        <tr>
                          <th className="task-table-col-check" aria-label="选择" />
                          <th>发起部门</th>
                          <th>执行部门</th>
                          <th>发起日期</th>
                          <th>请求描述</th>
                          <th>领导指示/建议</th>
                          <th>任务形成日期</th>
                          <th>任务计划角色</th>
                          <th>状态</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snap.rows.map((row, idx) => {
                          const st = planHistoryStatusLabel(row);
                          const selKey = planHistoryRowSelectKey(snap.id, idx);
                          return (
                          <tr key={`${snap.id}-${row.id}-${idx}`}>
                            <td className="task-table-col-check">
                              <input
                                type="checkbox"
                                checked={planHistorySelectedKeys.includes(selKey)}
                                disabled={st !== "待计划"}
                                onChange={() =>
                                  setPlanHistorySelectedKeys((prev) =>
                                    prev.includes(selKey)
                                      ? prev.filter((k) => k !== selKey)
                                      : [...prev, selKey],
                                  )
                                }
                                aria-label={`选择计划行 ${(row.requestDescription ?? "").slice(0, 24)}`}
                              />
                            </td>
                            <td>{row.initiatingDepartment}</td>
                            <td>{row.executingDepartment}</td>
                            <td>
                              <button
                                type="button"
                                className="text-btn"
                                onClick={() =>
                                  requestJumpToExtractionHistory(row.extractionHistoryId, row.jumpNeedle)
                                }
                              >
                                {formatReportCalendarDateZh(row.reportDate)}
                              </button>
                            </td>
                            <td className="task-text-wrap">{row.requestDescription}</td>
                            <td className="task-text-wrap muted tiny">{row.leaderInstructionSnapshot || "—"}</td>
                            <td className="mono tiny">{row.taskFormedOn}</td>
                            <td className="muted tiny">{row.planRolePerspective}</td>
                            <td className="tiny">
                              <span
                                className={
                                  st === "待计划" ? "plan-history-status plan-history-status--pending" : "plan-history-status"
                                }
                              >
                                {st}
                              </span>
                            </td>
                            <td className="plan-history-actions">
                              {st === "待计划" ? (
                                <button
                                  type="button"
                                  className="text-btn"
                                  onClick={() => {
                                    restorePlanHistoryRowFromPendingPlan(row.id);
                                    setPlanHistorySelectedKeys((prev) => prev.filter((k) => k !== selKey));
                                  }}
                                >
                                  返回计划
                                </button>
                              ) : (
                                <span className="muted tiny">—</span>
                              )}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </article>
              ))}
            </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function EditForm({
  task,
  perspective,
  orgLines,
  onSave,
  onClose,
}: {
  task: Task;
  perspective: string;
  orgLines: string[];
  onSave: (patch: Partial<Task>) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => ({
    ...task,
    taskMotivation: task.taskMotivation?.trim() ?? "",
    progressTracking: [...(task.progressTracking ?? [])],
    coordinationParty: task.coordinationParty ?? "",
    leaderInstruction: task.leaderInstruction ?? "",
  }));
  const [receiversStr, setReceiversStr] = useState(() =>
    task.receiverDepartments?.length
      ? task.receiverDepartments.join("，")
      : (task.receiverDepartment ?? ""),
  );

  const isGroupPerspective = perspective === GROUP_LEADER_PERSPECTIVE;
  const lockedInitiatorUnit = orgUnitFromPerspective(perspective);

  return (
    <form
      className="task-form modal-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (isGroupPerspective && !draft.department.trim()) {
          alert("请选择发起部门。");
          return;
        }
        if (!isGroupPerspective) {
          const u = lockedInitiatorUnit?.trim();
          if (!u || draft.department.trim() !== u) {
            alert("发起部门须与当前视角一致。");
            return;
          }
        }
        const exec = draft.executingDepartment?.trim() ?? "";
        if (!exec) {
          alert("请填写或选择执行部门。");
          return;
        }
        if (!isGroupPerspective && !orgStructureContainsDepartment(orgLines, exec)) {
          alert("执行部门须为部门架构中的职能部门或分公司。");
          return;
        }
        const dueRaw = draft.expectedCompletion.trim();
        if (!dueRaw) {
          alert("请填写期待完成时间（YYYY-MM-DD）或「待定」。");
          return;
        }
        if (!isIsoDateString(dueRaw) && dueRaw !== PENDING_EXPECTED_COMPLETION) {
          alert("期待完成请填写 YYYY-MM-DD 或「待定」。");
          return;
        }
        if (draft.status === "卡住待协调" && !draft.coordinationParty?.trim()) {
          alert("处于「卡住待协调」时必须选择协调方。");
          return;
        }
        const receiverDepartments = parseReceiverDepartments(receiversStr) ?? [];
        const { branch, workshop } = branchWorkshopFromExecuting(exec);
        onSave({
          initiator: draft.initiator,
          department: draft.department.trim(),
          executingDepartment: exec,
          categoryLevel1: draft.categoryLevel1,
          categoryLevel2: draft.categoryLevel2,
          taskMotivation: draft.taskMotivation?.trim() ?? "",
          description: draft.description,
          expectedCompletion: dueRaw,
          status: draft.status,
          branch,
          workshop,
          receiverDepartments,
          receiverDepartment: undefined,
          ...(draft.status === "卡住待协调" && draft.coordinationParty.trim()
            ? { coordinationParty: draft.coordinationParty.trim() }
            : { coordinationParty: undefined }),
          ...(draft.leaderInstruction?.trim()
            ? { leaderInstruction: draft.leaderInstruction.trim() }
            : { leaderInstruction: undefined }),
          ...(draft.progressTracking?.length
            ? { progressTracking: [...draft.progressTracking] }
            : { progressTracking: undefined }),
        });
      }}
    >
      <label>
        发起人
        <input
          value={draft.initiator}
          onChange={(e) => setDraft({ ...draft, initiator: e.target.value })}
        />
      </label>
      <label>
        发起部门
        {isGroupPerspective ? (
          <select
            value={draft.department}
            onChange={(e) => setDraft({ ...draft, department: e.target.value })}
            required
          >
            <option value="">请选择</option>
            {orgLines.map((line) => (
              <option key={line} value={line}>
                {line}
              </option>
            ))}
          </select>
        ) : (
          <input value={draft.department} readOnly className="fld-readonly" />
        )}
      </label>
      <label>
        执行部门
        {isGroupPerspective ? (
          <input
            value={draft.executingDepartment}
            onChange={(e) => setDraft({ ...draft, executingDepartment: e.target.value })}
            placeholder="可填写任意部门或分公司名称"
            list="task-exec-org-list-edit"
          />
        ) : (
          <select
            value={draft.executingDepartment}
            onChange={(e) => setDraft({ ...draft, executingDepartment: e.target.value })}
            required
          >
            <option value="">请选择</option>
            {orgLines.map((line) => (
              <option key={line} value={line}>
                {line}
              </option>
            ))}
          </select>
        )}
        <datalist id="task-exec-org-list-edit">
          {orgLines.map((line) => (
            <option key={line} value={line} />
          ))}
        </datalist>
      </label>
      <label className="full">
        接收 / 配合部门（逗号或顿号分隔）
        <input
          value={receiversStr}
          onChange={(e) => setReceiversStr(e.target.value)}
          placeholder="留空表示无"
        />
      </label>
      <label className="full">
        任务大类
        <select
          value={draft.categoryLevel1}
          onChange={(e) => {
            const l1 = e.target.value;
            const l2opts = level2NamesForLevel1(l1);
            setDraft({
              ...draft,
              categoryLevel1: l1,
              categoryLevel2: l2opts.includes(draft.categoryLevel2) ? draft.categoryLevel2 : (l2opts[0] ?? ""),
            });
          }}
        >
          {TASK_CATEGORY_LEVEL1_LIST.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="full">
        任务子类
        <select
          value={draft.categoryLevel2}
          onChange={(e) => setDraft({ ...draft, categoryLevel2: e.target.value })}
        >
          {level2NamesForLevel1(draft.categoryLevel1).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="full">
        任务动因
        <textarea
          rows={2}
          value={draft.taskMotivation}
          onChange={(e) => setDraft({ ...draft, taskMotivation: e.target.value })}
          placeholder="立项背景、触发原因或政策/事件依据（可选）"
        />
      </label>
      <label className="full">
        任务描述
        <textarea
          rows={3}
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
      </label>
      <label className="full">
        领导指示（可选）
        <textarea
          rows={2}
          value={draft.leaderInstruction}
          onChange={(e) => setDraft({ ...draft, leaderInstruction: e.target.value })}
          placeholder="可由日报计划或报告进度更新自动写入，也可手改"
        />
      </label>
      <label>
        期待完成时间
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="YYYY-MM-DD 或 待定"
          value={draft.expectedCompletion}
          onChange={(e) => setDraft({ ...draft, expectedCompletion: e.target.value })}
        />
      </label>
      <label>
        状态
        <select
          value={draft.status}
          onChange={(e) => {
            const st = e.target.value as TaskStatus;
            setDraft((prev) =>
              st === "卡住待协调"
                ? {
                    ...prev,
                    status: st,
                    coordinationParty:
                      prev.coordinationParty?.trim() || COORDINATION_PARTY_OPTIONS[0],
                  }
                : { ...prev, status: st, coordinationParty: "" },
            );
          }}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      {draft.status === "卡住待协调" && (
        <label className="full">
          协调方
          <select
            value={draft.coordinationParty || COORDINATION_PARTY_OPTIONS[0]}
            onChange={(e) => setDraft({ ...draft, coordinationParty: e.target.value })}
            required
          >
            {COORDINATION_PARTY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="full task-progress-tracking-section">
        <div className="task-progress-tracking-heading">进度跟踪</div>
        {!draft.progressTracking?.length ? (
          <p className="muted small task-progress-tracking-empty">
            暂无进展记录；可在<strong>报告</strong>页「现有任务进度更新」中根据日报写入。
          </p>
        ) : (
          <div className="table-wrap task-progress-tracking-table-wrap">
            <table className="data-table task-progress-tracking-table">
              <thead>
                <tr>
                  <th className="task-progress-tracking-col-date">日期</th>
                  <th>进展描述</th>
                </tr>
              </thead>
              <tbody>
                {[...draft.progressTracking]
                  .sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description))
                  .map((row, idx) => (
                    <tr key={`${row.date}-${idx}-${row.description.slice(0, 12)}`}>
                      <td className="mono task-progress-tracking-col-date">{row.date}</td>
                      <td className="task-text-wrap">{row.description}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="form-actions full">
        <button type="button" className="ghost-btn" onClick={onClose}>
          取消
        </button>
        <button type="submit" className="primary-btn">
          保存
        </button>
      </div>
    </form>
  );
}
