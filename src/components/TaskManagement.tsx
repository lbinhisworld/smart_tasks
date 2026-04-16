import { useState } from "react";
import {
  BRANCHES,
  CATEGORIES,
  STATUSES,
  useTasks,
  WORKSHOPS_BY_BRANCH,
} from "../context/TaskContext";
import type { Task, TaskCategory, TaskStatus } from "../types/task";

const emptyForm = {
  initiator: "",
  department: "",
  category: "安全生产" as TaskCategory,
  description: "",
  expectedCompletion: "",
  status: "进行中" as TaskStatus,
  branch: "淄博本部",
  workshop: "造纸一车间" as string | "",
};

export function TaskManagement() {
  const { visibleTasks, addTask, removeTask, updateTask, toggleFollow } = useTasks();
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<Task | null>(null);

  const workshops = WORKSHOPS_BY_BRANCH[form.branch] ?? [];

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
    addTask({
      initiator: form.initiator.trim(),
      department: form.department.trim(),
      category: form.category,
      description: form.description.trim(),
      expectedCompletion: form.expectedCompletion,
      status: form.status,
      branch: form.branch,
      workshop: form.workshop ? form.workshop : null,
    });
    setForm({ ...emptyForm, branch: form.branch, workshop: form.workshop || "造纸一车间" });
  }

  return (
    <div className="task-page">
      <section className="card">
        <div className="card-head">
          <h2>新建任务</h2>
          <p className="muted small">字段：发起人、发起部门、类别、描述、期待完成时间（状态与组织用于看板统计）</p>
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
              placeholder="如：质量管理部"
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
              onChange={(e) =>
                setForm({
                  ...form,
                  branch: e.target.value,
                  workshop: (WORKSHOPS_BY_BRANCH[e.target.value] ?? [])[0] ?? "",
                })
              }
            >
              {BRANCHES.map((b) => (
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
                  <td colSpan={9} className="empty-cell">
                    当前角色与范围下没有可见任务。
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
  onSave,
  onClose,
}: {
  task: Task;
  onSave: (patch: Partial<Task>) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(task);
  const wsList = WORKSHOPS_BY_BRANCH[draft.branch] ?? [];

  return (
    <form
      className="task-form modal-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          initiator: draft.initiator,
          department: draft.department,
          category: draft.category,
          description: draft.description,
          expectedCompletion: draft.expectedCompletion,
          status: draft.status,
          branch: draft.branch,
          workshop: draft.workshop || null,
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
          onChange={(e) =>
            setDraft({
              ...draft,
              branch: e.target.value,
              workshop: (WORKSHOPS_BY_BRANCH[e.target.value] ?? [])[0] ?? null,
            })
          }
        >
          {BRANCHES.map((b) => (
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
