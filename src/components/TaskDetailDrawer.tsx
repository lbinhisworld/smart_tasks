/**
 * @fileoverview 任务详情右侧滑出层（只读）：与任务管理列表中「详情」抽屉布局与样式一致。
 */

import { useEffect, useMemo, useState } from "react";
import type { Task, TaskProgressEntry } from "../types/task";
import { taskDetailDrawerToolbarModifierClass } from "./TaskStatusPill";

export function TaskDetailDrawer({ task, onClose }: { task: Task; onClose: () => void }) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setEntered(true));
    });
    return () => window.cancelAnimationFrame(id);
  }, [task.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [task.id, onClose]);

  const sortedProgressEntries = useMemo((): TaskProgressEntry[] => {
    const raw = task.progressTracking;
    if (!raw?.length) return [];
    return [...raw].sort(
      (a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description),
    );
  }, [task.progressTracking]);

  return (
    <div className="task-detail-drawer-root">
      <div
        className={`task-detail-drawer-backdrop${entered ? " is-visible" : ""}`}
        role="presentation"
        aria-hidden="true"
        onClick={onClose}
      />
      <aside
        className={`task-detail-drawer-panel${entered ? " is-visible" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-drawer-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`task-detail-drawer-toolbar ${taskDetailDrawerToolbarModifierClass(task.status)}`}>
          <h2 id="task-detail-drawer-title">{task.status}</h2>
          <button type="button" className="task-detail-drawer-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="task-detail-drawer-body">
          <dl className="task-detail-dl">
            <div>
              <dt>编号</dt>
              <dd className="mono">{task.code}</dd>
            </div>
            <div>
              <dt>发起人</dt>
              <dd>{task.initiator}</dd>
            </div>
            <div>
              <dt>发起部门</dt>
              <dd>{task.department}</dd>
            </div>
            <div>
              <dt>执行部门</dt>
              <dd className="muted tiny">{task.executingDepartment || "—"}</dd>
            </div>
            <div>
              <dt>接收/配合</dt>
              <dd className="muted tiny">
                {(task.receiverDepartments?.length
                  ? task.receiverDepartments.join("、")
                  : task.receiverDepartment) || "—"}
              </dd>
            </div>
            <div className="task-detail-dl-full">
              <dt>任务大类</dt>
              <dd className="task-text-wrap small">{task.categoryLevel1}</dd>
            </div>
            <div className="task-detail-dl-full">
              <dt>任务子类</dt>
              <dd className="task-text-wrap small">{task.categoryLevel2}</dd>
            </div>
            <div className="task-detail-dl-full">
              <dt>任务动因</dt>
              <dd className="task-detail-highlight-card task-text-wrap small">
                {task.taskMotivation?.trim() || "—"}
              </dd>
            </div>
            <div className="task-detail-dl-full">
              <dt>任务描述</dt>
              <dd className="task-detail-highlight-card task-text-wrap">{task.description}</dd>
            </div>
            <div className="task-detail-dl-full">
              <dt>领导指示</dt>
              <dd className="task-detail-leader-card task-text-wrap small">
                {task.leaderInstruction?.trim() || "—"}
              </dd>
            </div>
            <div>
              <dt>期待完成</dt>
              <dd>{task.expectedCompletion}</dd>
            </div>
            {task.status === "卡住待协调" && (
              <div>
                <dt>协调方</dt>
                <dd>{task.coordinationParty?.trim() || "—"}</dd>
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
                  <li
                    key={`${row.date}-${idx}-${row.description.slice(0, 24)}`}
                    className="task-detail-timeline-item"
                  >
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
  );
}
