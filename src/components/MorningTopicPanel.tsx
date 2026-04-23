/**
 * @fileoverview 报告管理「议题管理」：晨会议题 CRUD、分类/状态筛选；卡片列表优先展示议题标题（会议室大屏），卡片内可直接编辑最终结论与可复用经验并持久化，从议题派发任务与任务管理新建逻辑一致。
 *
 * @module MorningTopicPanel
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTasks } from "../context/TaskContext";
import type { Task } from "../types/task";
import {
  MORNING_TOPIC_CATEGORIES,
  MORNING_TOPIC_STATUSES,
  type MorningTopic,
  type MorningTopicCategory,
  type MorningTopicStatus,
} from "../types/morningTopic";
import {
  buildMorningTopicCode,
  loadMorningTopics,
  saveMorningTopics,
} from "../utils/morningTopicStorage";
import { localIsoDate } from "../utils/reportDailyListFromDataHub";
import { tomorrowIsoDateLocal } from "../utils/taskDueDate";
import { DispatchTaskFromTopicDrawer } from "./DispatchTaskFromTopicDrawer";
import {
  appendHighlightForRow,
  type DailyTopicDraftPayload,
} from "../utils/dailyReportTopicHighlightStorage";

function parseParticipants(raw: string): string[] {
  return raw
    .split(/[,，;；、\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isMorningCategory(v: string): v is MorningTopicCategory {
  return (MORNING_TOPIC_CATEGORIES as readonly string[]).includes(v);
}

function isMorningStatus(v: string): v is MorningTopicStatus {
  return (MORNING_TOPIC_STATUSES as readonly string[]).includes(v);
}

/**
 * 卡片左侧强调条与状态选择框的修饰 class，便于远距识别议题进度。
 *
 * @param status 议题状态
 * @returns BEM modifier，无匹配时为空串
 */
function morningTopicCardStatusModifier(status: MorningTopicStatus): string {
  switch (status) {
    case "未讨论":
      return "rmt-card--pending";
    case "已讨论":
      return "rmt-card--done";
    case "已关闭":
      return "rmt-card--closed";
    default:
      return "";
  }
}

/**
 * 「可复用经验」输入框占位说明：引导按问答对书写，便于检索与复用。
 */
const REUSABLE_EXPERIENCE_PLACEHOLDER = `建议采用问答对格式，多条经验之间空一行。

示例：
问：现场典型问题或偏差是什么？
答：根因、已采取措施与后续注意点。`;

export interface MorningTopicPanelProps {
  /** 由日报详情「添加至议题」带入；保存成功后写入高亮并由父级清空 */
  dailyTopicDraft?: DailyTopicDraftPayload | null;
  /** 保存议题成功并已写入日报高亮 */
  onDailyTopicDraftCommitted?: () => void;
  /** 关闭新建弹窗且未保存（含点遮罩）时清空草稿 */
  onDailyTopicDraftCancelled?: () => void;
}

/**
 * 议题管理主面板。
 */
export function MorningTopicPanel({
  dailyTopicDraft,
  onDailyTopicDraftCommitted,
  onDailyTopicDraftCancelled,
}: MorningTopicPanelProps) {
  const { user, addTask } = useTasks();
  const [topics, setTopics] = useState<MorningTopic[]>(() => loadMorningTopics());
  const skipDailyDraftCancelRef = useRef(false);
  const prevCreateOpenRef = useRef(false);
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [dispatchTopic, setDispatchTopic] = useState<MorningTopic | null>(null);

  const [draft, setDraft] = useState({
    description: "",
    category: "生产" as MorningTopicCategory,
    participantsStr: "",
    discussionDate: tomorrowIsoDateLocal(),
    finalConclusion: "",
    reusableExperience: "",
    notes: "",
    operatorName: "",
  });

  const replaceTopics = useCallback((updater: (prev: MorningTopic[]) => MorningTopic[]) => {
    setTopics((prev) => {
      const next = updater(prev);
      saveMorningTopics(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!dailyTopicDraft) return;
    const ex = dailyTopicDraft.excerpt.trim();
    if (!ex) return;
    setDraft((d) => ({ ...d, description: ex }));
    setCreateOpen(true);
  }, [dailyTopicDraft]);

  useEffect(() => {
    const wasOpen = prevCreateOpenRef.current;
    if (createOpen) {
      prevCreateOpenRef.current = true;
      return;
    }
    prevCreateOpenRef.current = false;
    if (!wasOpen) return;
    if (skipDailyDraftCancelRef.current) {
      skipDailyDraftCancelRef.current = false;
      return;
    }
    if (dailyTopicDraft) {
      onDailyTopicDraftCancelled?.();
    }
  }, [createOpen, dailyTopicDraft, onDailyTopicDraftCancelled]);

  useEffect(() => {
    if (!createOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCreateOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createOpen]);

  const filtered = useMemo(() => {
    return topics.filter((t) => {
      if (filterCategory && t.category !== filterCategory) return false;
      if (filterStatus && t.status !== filterStatus) return false;
      return true;
    });
  }, [topics, filterCategory, filterStatus]);

  const openNew = () => {
    setDraft({
      description: "",
      category: "生产",
      participantsStr: "",
      discussionDate: tomorrowIsoDateLocal(),
      finalConclusion: "",
      reusableExperience: "",
      notes: "",
      operatorName: "",
    });
    setCreateOpen(true);
  };

  const saveNew = () => {
    const desc = draft.description.trim();
    if (!desc) {
      window.alert("请填写议题描述。");
      return;
    }
    const id = `mt_${Date.now()}`;
    const row: MorningTopic = {
      id,
      code: buildMorningTopicCode(),
      description: desc,
      category: draft.category,
      participants: parseParticipants(draft.participantsStr),
      discussionDate: draft.discussionDate.trim() || tomorrowIsoDateLocal(),
      createdAt: localIsoDate(),
      finalConclusion: draft.finalConclusion.trim(),
      reusableExperience: draft.reusableExperience.trim(),
      status: "未讨论",
      notes: draft.notes.trim(),
      operatorName: draft.operatorName.trim(),
    };
    replaceTopics((prev) => [row, ...prev]);
    skipDailyDraftCancelRef.current = true;
    if (dailyTopicDraft) {
      appendHighlightForRow(
        dailyTopicDraft.rowKey,
        { start: dailyTopicDraft.start, end: dailyTopicDraft.end, topicCode: row.code },
        dailyTopicDraft.fullTextLen,
      );
      onDailyTopicDraftCommitted?.();
    }
    setCreateOpen(false);
  };

  const patchTopic = (id: string, patch: Partial<MorningTopic>) => {
    replaceTopics((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const removeTopic = (id: string) => {
    if (!window.confirm("确定删除该议题？")) return;
    replaceTopics((prev) => prev.filter((t) => t.id !== id));
  };

  const onDispatched = (topicId: string, task: Task) => {
    replaceTopics((prev) =>
      prev.map((t) => {
        if (t.id !== topicId) return t;
        const prevCodes = t.linkedTaskCodes ?? [];
        return { ...t, linkedTaskCodes: [...prevCodes, task.code] };
      }),
    );
  };

  return (
    <section
      className="card report-tab-panel report-morning-topic-panel report-morning-topic-panel--boardroom"
      data-morning-topic-layout="cards-v3"
    >
      <div className="card-head report-morning-topic-head">
        <div>
          <h2 className="report-morning-topic-title">议题管理</h2>
          <p className="muted small report-morning-topic-lede">
            面向例行晨会与会议室大屏：每条议题以卡片呈现，标题优先便于远距阅读。支持新建或由「日报列表」摘录发起；派发任务与「任务管理」手工新建一致并关联议题编号。「最终结论」「可复用经验」可在卡片内直接填写，实时保存。
          </p>
        </div>
        <button type="button" className="primary-btn report-morning-topic-new-btn" onClick={openNew}>
          新建议题
        </button>
      </div>

      <div className="report-morning-topic-filters">
        <label className="report-morning-topic-filter">
          <span className="muted tiny">议题分类</span>
          <select
            className="fld"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
          >
            <option value="">全部分类</option>
            {MORNING_TOPIC_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="report-morning-topic-filter">
          <span className="muted tiny">状态</span>
          <select className="fld" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">全部状态</option>
            {MORNING_TOPIC_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="report-morning-topic-cards-outer">
        {filtered.length === 0 ? (
          <div className="report-morning-topic-cards-empty" role="status">
            暂无议题，点击「新建议题」或从日报详情添加。
          </div>
        ) : (
          <div className="report-morning-topic-cards" role="list" aria-label="晨会议题列表">
            {filtered.map((t) => (
              <article
                key={t.id}
                className={`report-morning-topic-card ${morningTopicCardStatusModifier(t.status)}`}
                role="listitem"
              >
                <div className="report-morning-topic-card-hero">
                  <h3 className="report-morning-topic-card-title">{t.description || "—"}</h3>
                  <div className="report-morning-topic-card-subhead">
                    <div className="report-morning-topic-card-identity">
                      <span className="report-morning-topic-card-code mono" title={t.code}>
                        {t.code}
                      </span>
                      <span className="report-morning-topic-card-cat">{t.category}</span>
                    </div>
                    <select
                      className="fld report-morning-topic-card-status"
                      value={t.status}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (isMorningStatus(v)) patchTopic(t.id, { status: v });
                      }}
                      aria-label={`议题 ${t.code} 状态`}
                    >
                      {MORNING_TOPIC_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <dl className="report-morning-topic-card-meta">
                  <div className="report-morning-topic-card-meta-row">
                    <dt>参与人</dt>
                    <dd>{t.participants.length ? t.participants.join("、") : "—"}</dd>
                  </div>
                  <div className="report-morning-topic-card-meta-row">
                    <dt>讨论时间</dt>
                    <dd className="mono">{t.discussionDate}</dd>
                  </div>
                  <div className="report-morning-topic-card-meta-row">
                    <dt>创建时间</dt>
                    <dd className="mono">{t.createdAt}</dd>
                  </div>
                </dl>

                <div className="report-morning-topic-card-insights">
                  <div className="report-morning-topic-card-block">
                    <label className="report-morning-topic-card-block-label" htmlFor={`rmt-fc-${t.id}`}>
                      最终结论
                    </label>
                    <textarea
                      id={`rmt-fc-${t.id}`}
                      className="fld report-morning-topic-card-textarea"
                      rows={3}
                      value={t.finalConclusion}
                      onChange={(e) => patchTopic(t.id, { finalConclusion: e.target.value })}
                      placeholder="晨会形成的结论要点，可直接填写"
                      aria-label={`${t.code} 最终结论`}
                    />
                  </div>
                  <div className="report-morning-topic-card-block">
                    <label className="report-morning-topic-card-block-label" htmlFor={`rmt-re-${t.id}`}>
                      可复用经验
                    </label>
                    <textarea
                      id={`rmt-re-${t.id}`}
                      className="fld report-morning-topic-card-textarea"
                      rows={4}
                      value={t.reusableExperience}
                      onChange={(e) => patchTopic(t.id, { reusableExperience: e.target.value })}
                      placeholder={REUSABLE_EXPERIENCE_PLACEHOLDER}
                      aria-label={`${t.code} 可复用经验`}
                    />
                  </div>
                </div>

                {t.notes.trim() ? (
                  <div className="report-morning-topic-card-notes">
                    <span className="report-morning-topic-card-block-label">备注</span>
                    <p className="report-morning-topic-card-notes-body">{t.notes}</p>
                  </div>
                ) : null}

                <footer className="report-morning-topic-card-foot">
                  <div
                    className="report-morning-topic-card-tasks mono"
                    title={(t.linkedTaskCodes ?? []).join("、")}
                  >
                    <span className="report-morning-topic-card-foot-label">关联任务</span>
                    <span className="report-morning-topic-card-tasks-val">
                      {(t.linkedTaskCodes?.length ?? 0) > 0 ? (t.linkedTaskCodes ?? []).join("、") : "—"}
                    </span>
                  </div>
                  <div className="report-morning-topic-card-actions">
                    <button
                      type="button"
                      className="ghost-btn report-morning-topic-card-action-btn"
                      onClick={() => setDispatchTopic(t)}
                    >
                      派发
                    </button>
                    <button
                      type="button"
                      className="ghost-btn report-morning-topic-card-action-btn danger-text"
                      onClick={() => removeTopic(t.id)}
                    >
                      删除
                    </button>
                  </div>
                </footer>
              </article>
            ))}
          </div>
        )}
      </div>

      {createOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => {
            setCreateOpen(false);
          }}
        >
          <div className="modal report-morning-topic-modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>新建议题</h3>
            <label className="report-morning-topic-modal-field">
              <span>议题描述</span>
              <textarea
                rows={4}
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="晨会讨论要点，可由操作人自定义"
              />
            </label>
            <label className="report-morning-topic-modal-field">
              <span>议题分类</span>
              <select
                value={draft.category}
                onChange={(e) => {
                  const v = e.target.value;
                  if (isMorningCategory(v)) setDraft((d) => ({ ...d, category: v }));
                }}
              >
                {MORNING_TOPIC_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="report-morning-topic-modal-field">
              <span>参与人（多人用逗号、顿号分隔）</span>
              <input
                value={draft.participantsStr}
                onChange={(e) => setDraft((d) => ({ ...d, participantsStr: e.target.value }))}
                placeholder="如：张三、李四"
              />
            </label>
            <label className="report-morning-topic-modal-field">
              <span>讨论时间</span>
              <input
                type="date"
                value={draft.discussionDate}
                onChange={(e) => setDraft((d) => ({ ...d, discussionDate: e.target.value }))}
              />
            </label>
            <label className="report-morning-topic-modal-field">
              <span>操作人（可空，空则仅记录当前视角）</span>
              <input
                value={draft.operatorName}
                onChange={(e) => setDraft((d) => ({ ...d, operatorName: e.target.value }))}
                placeholder={user.perspective}
              />
            </label>
            <label className="report-morning-topic-modal-field">
              <span>最终结论（可空，保存后可在卡片内继续修改）</span>
              <textarea
                rows={2}
                value={draft.finalConclusion}
                onChange={(e) => setDraft((d) => ({ ...d, finalConclusion: e.target.value }))}
                placeholder="晨会形成的结论要点"
              />
            </label>
            <label className="report-morning-topic-modal-field">
              <span>可复用经验（可空，建议问答对格式）</span>
              <textarea
                rows={3}
                value={draft.reusableExperience}
                onChange={(e) => setDraft((d) => ({ ...d, reusableExperience: e.target.value }))}
                placeholder={REUSABLE_EXPERIENCE_PLACEHOLDER}
              />
            </label>
            <label className="report-morning-topic-modal-field">
              <span>备注</span>
              <textarea
                rows={2}
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                placeholder="可选"
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setCreateOpen(false)}>
                取消
              </button>
              <button type="button" className="primary-btn" onClick={saveNew}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      <DispatchTaskFromTopicDrawer
        open={dispatchTopic !== null}
        topic={dispatchTopic}
        user={user}
        onClose={() => setDispatchTopic(null)}
        addTask={addTask}
        onDispatched={(task) => {
          if (dispatchTopic) onDispatched(dispatchTopic.id, task);
        }}
      />
    </section>
  );
}
