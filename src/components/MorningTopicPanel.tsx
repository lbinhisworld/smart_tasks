/**
 * @fileoverview 报告管理「议题管理」：晨会议题 CRUD、分类/状态筛选、从议题派发任务（与任务管理新建逻辑一致）。
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
 * 「可复用经验」输入框占位说明：引导按问答对书写，便于检索与复用。
 */
const REUSABLE_EXPERIENCE_PLACEHOLDER = `建议采用问答对格式，多条经验之间空一行。

示例：
问：现场典型问题或偏差是什么？
答：根因、已采取措施与后续注意点。`;

/** 列表内「结论 / 经验」弹窗编辑态 */
interface InsightModalState {
  id: string;
  code: string;
  finalConclusion: string;
  reusableExperience: string;
}

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
  const [insightModal, setInsightModal] = useState<InsightModalState | null>(null);
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

  useEffect(() => {
    if (!insightModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInsightModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [insightModal]);

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
    <section className="card report-tab-panel report-morning-topic-panel">
      <div className="card-head report-morning-topic-head">
        <div>
          <h2 className="report-morning-topic-title">议题管理</h2>
          <p className="muted small">
            用于公司高管晨会议题；支持新建或由「日报列表」详情摘录发起。派发任务与「任务管理 · 手工新建任务」一致，并自动关联议题编号。表中「最终结论」「可复用经验」为两行预览，完整录入请点操作列「编辑」。
          </p>
        </div>
        <button type="button" className="primary-btn tiny-btn" onClick={openNew}>
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

      <div className="report-daily-list-table-wrap report-morning-topic-table-outer">
        <table className="report-daily-list-table report-morning-topic-table">
          <colgroup>
            <col className="rmt-col-desc" />
            <col className="rmt-col-cat" />
            <col className="rmt-col-part" />
            <col className="rmt-col-discuss" />
            <col className="rmt-col-created" />
            <col className="rmt-col-snip" />
            <col className="rmt-col-snip" />
            <col className="rmt-col-status" />
            <col className="rmt-col-notes" />
            <col className="rmt-col-tasks" />
            <col className="rmt-col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th>议题描述</th>
              <th>议题分类</th>
              <th>参与人</th>
              <th>讨论时间</th>
              <th>创建时间</th>
              <th>最终结论</th>
              <th>可复用经验</th>
              <th>状态</th>
              <th>备注</th>
              <th>关联任务</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={11} className="report-daily-list-empty-cell">
                  暂无议题，点击「新建议题」或从日报详情添加。
                </td>
              </tr>
            ) : (
              filtered.map((t) => (
                <tr key={t.id}>
                  <td className="report-morning-topic-desc-cell" title={t.description}>
                    <span className="report-morning-topic-desc-clamp">
                      {t.description.length > 72 ? `${t.description.slice(0, 72)}…` : t.description || "—"}
                    </span>
                  </td>
                  <td className="report-morning-topic-td-nowrap">{t.category}</td>
                  <td className="muted tiny report-morning-topic-td-part">{t.participants.length ? t.participants.join("、") : "—"}</td>
                  <td className="mono tiny report-morning-topic-td-nowrap report-morning-topic-td-discuss-date">
                    {t.discussionDate}
                  </td>
                  <td className="mono tiny report-morning-topic-td-nowrap report-morning-topic-td-created-date">
                    {t.createdAt}
                  </td>
                  <td className="report-morning-topic-snippet-cell">
                    <div
                      className={`report-morning-topic-snippet${t.finalConclusion.trim() ? "" : " is-empty"}`}
                      title={t.finalConclusion.trim() || undefined}
                    >
                      {t.finalConclusion.trim() ? t.finalConclusion : "—"}
                    </div>
                  </td>
                  <td className="report-morning-topic-snippet-cell">
                    <div
                      className={`report-morning-topic-snippet${t.reusableExperience.trim() ? "" : " is-empty"}`}
                      title={t.reusableExperience.trim() || undefined}
                    >
                      {t.reusableExperience.trim() ? t.reusableExperience : "—"}
                    </div>
                  </td>
                  <td>
                    <select
                      className="fld tiny-select report-morning-topic-status-select"
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
                  </td>
                  <td className="muted tiny" title={t.notes}>
                    {t.notes.length > 20 ? `${t.notes.slice(0, 20)}…` : t.notes || "—"}
                  </td>
                  <td className="mono tiny report-morning-topic-td-tasks" title={(t.linkedTaskCodes ?? []).join("、")}>
                    {(t.linkedTaskCodes?.length ?? 0) > 0 ? (t.linkedTaskCodes ?? []).join("、") : "—"}
                  </td>
                  <td className="report-morning-topic-td-actions">
                    <div className="report-morning-topic-actions">
                      <button
                        type="button"
                        className="ghost-btn tiny-btn"
                        title="编辑最终结论与可复用经验"
                        aria-label={`议题 ${t.code} 编辑结论与经验`}
                        onClick={() =>
                          setInsightModal({
                            id: t.id,
                            code: t.code,
                            finalConclusion: t.finalConclusion,
                            reusableExperience: t.reusableExperience,
                          })
                        }
                      >
                        编辑
                      </button>
                      <button type="button" className="ghost-btn tiny-btn" onClick={() => setDispatchTopic(t)}>
                        派发
                      </button>
                      <button type="button" className="ghost-btn tiny-btn danger-text" onClick={() => removeTopic(t.id)}>
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
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
              <span>最终结论（可空，会后可在列表点「编辑」补录）</span>
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

      {insightModal ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => {
            setInsightModal(null);
          }}
        >
          <div className="modal report-morning-topic-modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>编辑结论与经验 · {insightModal.code}</h3>
            <label className="report-morning-topic-modal-field">
              <span>最终结论</span>
              <textarea
                rows={5}
                value={insightModal.finalConclusion}
                onChange={(e) =>
                  setInsightModal((m) => (m ? { ...m, finalConclusion: e.target.value } : m))
                }
                placeholder="晨会形成的结论要点"
              />
            </label>
            <label className="report-morning-topic-modal-field">
              <span>可复用经验（建议问答对格式）</span>
              <textarea
                rows={5}
                value={insightModal.reusableExperience}
                onChange={(e) =>
                  setInsightModal((m) => (m ? { ...m, reusableExperience: e.target.value } : m))
                }
                placeholder={REUSABLE_EXPERIENCE_PLACEHOLDER}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setInsightModal(null)}>
                取消
              </button>
              <button
                type="button"
                className="primary-btn"
                onClick={() => {
                  patchTopic(insightModal.id, {
                    finalConclusion: insightModal.finalConclusion.trim(),
                    reusableExperience: insightModal.reusableExperience.trim(),
                  });
                  setInsightModal(null);
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
