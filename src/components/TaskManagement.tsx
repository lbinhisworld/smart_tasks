import { useEffect, useMemo, useState } from "react";
import {
  CATEGORIES,
  DEFAULT_WORKSHOPS_FOR_SCOPE,
  STATUSES,
  useTasks,
  WORKSHOPS_BY_BRANCH,
} from "../context/TaskContext";
import type { Task, TaskCategory, TaskStatus } from "../types/task";
import { getBranchCompanyNamesFromOrg } from "../utils/leaderPerspective";
import { ORG_STRUCTURE_CHANGED_EVENT } from "../utils/orgStructureStorage";

function parseReceiverDepartments(s: string): string[] | undefined {
  const parts = s
    .split(/[,，;；\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

function makeEmptyForm() {
  const branches = getBranchCompanyNamesFromOrg();
  const branch = branches[0] ?? "华林分公司";
  const ws = WORKSHOPS_BY_BRANCH[branch] ?? DEFAULT_WORKSHOPS_FOR_SCOPE;
  const workshop = ws[0] ?? "造纸一车间";
  return {
    initiator: "",
    department: "",
    category: "安全生产" as TaskCategory,
    description: "",
    expectedCompletion: "",
    status: "进行中" as TaskStatus,
    branch,
    workshop: workshop as string | "",
    receiversStr: "",
  };
}

export function TaskManagement() {
  const { visibleTasks, addTask, removeTask, updateTask, toggleFollow } = useTasks();
  const [orgEpoch, setOrgEpoch] = useState(0);
  const [form, setForm] = useState(makeEmptyForm);
  const [editing, setEditing] = useState<Task | null>(null);

  const branchNames = useMemo(() => {
    const b = getBranchCompanyNamesFromOrg();
    return b.length ? b : ["广西分公司", "华林分公司"];
  }, [orgEpoch]);

  useEffect(() => {
    const bump = () => setOrgEpoch((n) => n + 1);
    window.addEventListener(ORG_STRUCTURE_CHANGED_EVENT, bump);
    return () => window.removeEventListener(ORG_STRUCTURE_CHANGED_EVENT, bump);
  }, []);

  const workshops = WORKSHOPS_BY_BRANCH[form.branch] ?? DEFAULT_WORKSHOPS_FOR_SCOPE;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.initiator.trim() || !form.department.trim() || !form.description.trim()) {
      alert("请填写发起人、发起部门与任务描述。");
      return;
    }
    if (!form.expectedCompletion) {
      alert("请选择期待完成时间。");
      return;
    }
    const receiverDepartments = parseReceiverDepartments(form.receiversStr);
    addTask({
      initiator: form.initiator.trim(),
      department: form.department.trim(),
      category: form.category,
      description: form.description.trim(),
      expectedCompletion: form.expectedCompletion,
      status: form.status,
      branch: form.branch,
      workshop: form.workshop ? form.workshop : null,
      ...(receiverDepartments ? { receiverDepartments } : {}),
    });
    setForm(makeEmptyForm());
  }

  return (
    <div className="task-page">
      <section className="card">
        <div className="card-head">
          <h2>新建任务</h2>
          <p className="muted small">
            字段：发起人、发起部门、接收/配合部门（可选）、类别、描述、期待完成时间；分公司与车间来自配置中的分公司架构。
          </p>
        </div>
        <form className="task-form" onSubmit={submit}>
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
            <input
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
              placeholder="如：技术部"
            />
          </label>
          <label className="full">
            接收 / 配合部门（可选，逗号或顿号分隔）
            <input
              value={form.receiversStr}
              onChange={(e) => setForm({ ...form, receiversStr: e.target.value })}
              placeholder="如：财务部，采购部"
            />
          </label>
          <label>
            任务类别
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as TaskCategory })}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
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
          <label>
            期待完成时间
            <input
              type="date"
              value={form.expectedCompletion}
              onChange={(e) => setForm({ ...form, expectedCompletion: e.target.value })}
            />
          </label>
          <label>
            状态
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            分公司
            <select
              value={form.branch}
              onChange={(e) => {
                const b = e.target.value;
                const ws = WORKSHOPS_BY_BRANCH[b] ?? DEFAULT_WORKSHOPS_FOR_SCOPE;
                setForm({
                  ...form,
                  branch: b,
                  workshop: ws[0] ?? "",
                });
              }}
            >
              {branchNames.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label>
            车间（可空表示分公司/部门层级直管）
            <select
              value={form.workshop}
              onChange={(e) => setForm({ ...form, workshop: e.target.value })}
            >
              <option value="">（无车间 / 直管）</option>
              {workshops.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions full">
            <button type="submit" className="primary-btn">
              保存任务
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>任务列表（按权限过滤）</h2>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>编号</th>
                <th>发起人</th>
                <th>发起部门</th>
                <th>接收/配合</th>
                <th>类别</th>
                <th>描述</th>
                <th>期待完成</th>
                <th>状态</th>
                <th>组织</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibleTasks.map((t) => (
                <tr key={t.id}>
                  <td className="mono">{t.code}</td>
                  <td>{t.initiator}</td>
                  <td>{t.department}</td>
                  <td className="muted tiny">
                    {(t.receiverDepartments?.length ? t.receiverDepartments.join("、") : t.receiverDepartment) || "—"}
                  </td>
                  <td>{t.category}</td>
                  <td className="clamp wide">{t.description}</td>
                  <td>{t.expectedCompletion}</td>
                  <td>
                    <select
                      className="inline-select"
                      value={t.status}
                      onChange={(e) =>
                        updateTask(t.id, { status: e.target.value as TaskStatus })
                      }
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="muted tiny">
                    {t.branch}
                    {t.workshop ? ` / ${t.workshop}` : ""}
                  </td>
                  <td className="actions">
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
                        if (confirm("确定删除该任务？")) removeTask(t.id);
                      }}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {visibleTasks.length === 0 && (
                <tr>
                  <td colSpan={10} className="empty-cell">
                    当前视角与范围下没有可见任务。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

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
              task={editing}
              branchOptions={branchNames}
              onSave={(patch) => {
                updateTask(editing.id, patch);
                setEditing(null);
              }}
              onClose={() => setEditing(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function EditForm({
  task,
  branchOptions,
  onSave,
  onClose,
}: {
  task: Task;
  branchOptions: string[];
  onSave: (patch: Partial<Task>) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(task);
  const [receiversStr, setReceiversStr] = useState(() =>
    task.receiverDepartments?.length
      ? task.receiverDepartments.join("，")
      : (task.receiverDepartment ?? ""),
  );
  const wsList = WORKSHOPS_BY_BRANCH[draft.branch] ?? DEFAULT_WORKSHOPS_FOR_SCOPE;

  return (
    <form
      className="task-form modal-form"
      onSubmit={(e) => {
        e.preventDefault();
        const receiverDepartments = parseReceiverDepartments(receiversStr) ?? [];
        onSave({
          initiator: draft.initiator,
          department: draft.department,
          category: draft.category,
          description: draft.description,
          expectedCompletion: draft.expectedCompletion,
          status: draft.status,
          branch: draft.branch,
          workshop: draft.workshop || null,
          receiverDepartments,
          receiverDepartment: undefined,
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
        <input
          value={draft.department}
          onChange={(e) => setDraft({ ...draft, department: e.target.value })}
        />
      </label>
      <label className="full">
        接收 / 配合部门（逗号或顿号分隔）
        <input
          value={receiversStr}
          onChange={(e) => setReceiversStr(e.target.value)}
          placeholder="留空表示无"
        />
      </label>
      <label>
        任务类别
        <select
          value={draft.category}
          onChange={(e) => setDraft({ ...draft, category: e.target.value as TaskCategory })}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="full">
        任务描述
        <textarea
          rows={3}
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
      </label>
      <label>
        期待完成时间
        <input
          type="date"
          value={draft.expectedCompletion}
          onChange={(e) => setDraft({ ...draft, expectedCompletion: e.target.value })}
        />
      </label>
      <label>
        状态
        <select
          value={draft.status}
          onChange={(e) => setDraft({ ...draft, status: e.target.value as TaskStatus })}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label>
        分公司
        <select
          value={draft.branch}
          onChange={(e) => {
            const b = e.target.value;
            const ws = WORKSHOPS_BY_BRANCH[b] ?? DEFAULT_WORKSHOPS_FOR_SCOPE;
            setDraft({
              ...draft,
              branch: b,
              workshop: ws[0] ?? null,
            });
          }}
        >
          {branchOptions.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </label>
      <label>
        车间
        <select
          value={draft.workshop ?? ""}
          onChange={(e) => setDraft({ ...draft, workshop: e.target.value || null })}
        >
          <option value="">（无车间）</option>
          {wsList.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </label>
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
