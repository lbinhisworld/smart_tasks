/**
 * @fileoverview 从晨会议题派发任务：表单与校验对齐「任务管理 · 手工新建任务」，并写入 `sourceMorningTopicId` 建立关联。
 *
 * @module DispatchTaskFromTopicDrawer
 */

import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { STATUSES } from "../context/TaskContext";
import {
  getDefaultCategoryPair,
  level2NamesForLevel1,
  TASK_CATEGORY_LEVEL1_LIST,
} from "../data/taskCategories";
import type { MorningTopic } from "../types/morningTopic";
import {
  COORDINATION_PARTY_OPTIONS,
  type CurrentUser,
  type Task,
  type TaskStatus,
} from "../types/task";
import {
  branchRootFromOrgPath,
  GROUP_LEADER_PERSPECTIVE,
  isBranchCompanyUnit,
  orgStructureContainsDepartment,
  orgUnitFromPerspective,
} from "../utils/leaderPerspective";
import { getOrgStructureLines } from "../utils/orgStructureStorage";
import {
  isIsoDateString,
  PENDING_EXPECTED_COMPLETION,
  tomorrowIsoDateLocal,
} from "../utils/taskDueDate";
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
    expectedCompletion: tomorrowIsoDateLocal(),
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

export interface DispatchTaskFromTopicDrawerProps {
  /** 是否打开 */
  open: boolean;
  /** 目标议题 */
  topic: MorningTopic | null;
  user: CurrentUser;
  /** 关闭抽屉 */
  onClose: () => void;
  /** 与 TaskContext.addTask 一致 */
  addTask: (input: Omit<Task, "id" | "code" | "createdAt"> & { code?: string }) => Task;
  /** 派发成功（返回新建任务） */
  onDispatched: (task: Task) => void;
}

/**
 * 侧滑表单：从议题派发任务。
 */
export function DispatchTaskFromTopicDrawer({
  open,
  topic,
  user,
  onClose,
  addTask,
  onDispatched,
}: DispatchTaskFromTopicDrawerProps) {
  const execListId = useId().replace(/:/g, "");
  const orgLines = useMemo(() => getOrgStructureLines(), [open]);
  const [form, setForm] = useState(() => makeEmptyForm(user.perspective, orgLines));
  const [entered, setEntered] = useState(false);

  const isGroupPerspective = user.perspective === GROUP_LEADER_PERSPECTIVE;
  const lockedInitiatorUnit = orgUnitFromPerspective(user.perspective);

  useEffect(() => {
    if (!open || !topic) return;
    setForm(() => {
      const base = makeEmptyForm(user.perspective, getOrgStructureLines());
      const head = `[晨会议题 ${topic.code}]`;
      return {
        ...base,
        taskMotivation: `${head} ${topic.category}。议题摘要见任务描述。`,
        description: `${topic.description.trim()}\n\n—— 来源：晨会议题 ${topic.code}；讨论日 ${topic.discussionDate}`,
      };
    });
  }, [open, topic, user.perspective]);

  useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setEntered(true));
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !topic) return null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!topic) return;
    if (!form.initiator.trim() || !form.description.trim()) {
      window.alert("请填写发起人与任务描述。");
      return;
    }
    if (isGroupPerspective && !form.department.trim()) {
      window.alert("请选择发起部门。");
      return;
    }
    if (!isGroupPerspective) {
      const u = lockedInitiatorUnit?.trim();
      if (!u || form.department.trim() !== u) {
        window.alert("发起部门须与当前视角一致。");
        return;
      }
    }
    const exec = form.executingDepartment.trim();
    if (!exec) {
      window.alert("请填写或选择执行部门。");
      return;
    }
    if (!isGroupPerspective) {
      if (!orgStructureContainsDepartment(orgLines, exec)) {
        window.alert("执行部门须为部门架构中的职能部门或分公司。");
        return;
      }
    }
    const dueRaw = form.expectedCompletion.trim();
    if (!dueRaw) {
      window.alert("请选择期待完成日期，或点击「设为待定」。");
      return;
    }
    if (!isIsoDateString(dueRaw) && dueRaw !== PENDING_EXPECTED_COMPLETION) {
      window.alert("期待完成须为有效日期或「待定」。");
      return;
    }
    if (form.status === "卡住待协调" && !form.coordinationParty?.trim()) {
      window.alert("处于「卡住待协调」时必须选择协调方。");
      return;
    }
    const receiverDepartments = parseReceiverDepartments(form.receiversStr);
    const { branch, workshop } = branchWorkshopFromExecuting(exec);
    const task = addTask({
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
      sourceMorningTopicId: topic.id,
      ...(form.status === "卡住待协调" && form.coordinationParty.trim()
        ? { coordinationParty: form.coordinationParty.trim() }
        : {}),
      ...(form.leaderInstruction?.trim()
        ? { leaderInstruction: form.leaderInstruction.trim() }
        : {}),
      ...(receiverDepartments ? { receiverDepartments } : {}),
    });
    onDispatched(task);
    onClose();
  }

  return (
    <div className="task-new-drawer-root">
      <div
        className={`task-new-drawer-backdrop${entered ? " is-visible" : ""}`}
        role="presentation"
        aria-hidden="true"
        onClick={onClose}
      />
      <aside
        className={`task-new-drawer-panel${entered ? " is-visible" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dispatch-from-topic-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="task-new-drawer-toolbar">
          <h2 id="dispatch-from-topic-title">派发任务（议题 {topic.code}）</h2>
          <button type="button" className="task-new-drawer-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="muted small task-new-drawer-hint">
          与「任务管理 → 手工新建任务」字段与校验一致；保存后任务将带议题关联，可在任务描述中追溯编号。
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
                list={execListId}
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
            <datalist id={execListId}>
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
              rows={4}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="目标、交付物、关键里程碑等"
            />
          </label>
          <label className="full">
            领导指示（可选）
            <textarea
              rows={2}
              value={form.leaderInstruction}
              onChange={(e) => setForm({ ...form, leaderInstruction: e.target.value })}
              placeholder="领导指示、批示或建议原文摘录"
            />
          </label>
          <label className="task-due-date-label">
            <span>期待完成时间</span>
            <div className="task-due-date-row">
              <input
                type="date"
                className="fld"
                autoComplete="off"
                value={isIsoDateString(form.expectedCompletion) ? form.expectedCompletion : ""}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  setForm({
                    ...form,
                    expectedCompletion: v ? v : PENDING_EXPECTED_COMPLETION,
                  });
                }}
              />
              <button
                type="button"
                className="ghost-btn tiny-btn"
                onClick={() => setForm({ ...form, expectedCompletion: PENDING_EXPECTED_COMPLETION })}
              >
                设为待定
              </button>
            </div>
            {form.expectedCompletion === PENDING_EXPECTED_COMPLETION ? (
              <span className="muted tiny task-due-pending-note">当前为「待定」</span>
            ) : null}
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
                        coordinationParty: prev.coordinationParty?.trim() || COORDINATION_PARTY_OPTIONS[0],
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
            <button type="button" className="ghost-btn" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="primary-btn">
              保存任务
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
