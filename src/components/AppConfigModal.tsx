import { useCallback, useEffect, useState } from "react";
import { useTasks } from "../context/TaskContext";
import {
  clearStoredDeepseekApiKey,
  getStoredDeepseekApiKey,
  setStoredDeepseekApiKey,
} from "../utils/llmExtract";
import {
  clearLlmCallLogs,
  LLM_CALL_LOG_CHANGED_EVENT,
  readLlmCallLogs,
  type LlmCallLogEntry,
} from "../utils/llmCallLog";
import {
  getCoreMemoryText,
  setCoreMemoryText,
} from "../utils/homeAssistantPrompt";
import {
  readAssistantHistoryMarkdownFile,
  downloadAssistantHistoryMd,
  saveAssistantHistoryMarkdownFromEditor,
} from "../utils/assistantHistoryMd";
import {
  getAiChatSkillMarkdown,
  setAiChatSkillMarkdown,
  validateAiChatSkillMarkdownShape,
  downloadAiChatSkillMd,
} from "../utils/aiChatSkillStore";
import {
  readSkillUpdateMarkdown,
  downloadSkillUpdateMd,
  saveSkillUpdateMarkdownFromEditor,
} from "../utils/aiChatSkillRevision";
import { parseOrgStructureUserInput } from "../utils/orgStructureInput";
import { getOrgStructureText, setOrgStructureText } from "../utils/orgStructureStorage";
import {
  getSmartsheetWebhookRowsForEditor,
  saveSmartsheetWebhookRowsFromEditor,
  SMARTSHEET_WEBHOOK_PURPOSE_LABELS,
  SMARTSHEET_WEBHOOK_PURPOSE_TASK,
} from "../utils/smartsheetWebhooksStorage";
import {
  loadTaskSmartsheetFieldIds,
  resetTaskSmartsheetFieldIdsToDefaults,
  saveTaskSmartsheetFieldIds,
  TASK_SMARTSHEET_FIELD_KEYS,
  TASK_SMARTSHEET_FIELD_LABELS,
  type TaskSmartsheetFieldKey,
} from "../utils/smartsheetTaskFieldIdsStorage";

type ConfigTab =
  | "llm"
  | "llm_logs"
  | "org"
  | "smartsheet"
  | "history_md"
  | "core_memory_md"
  | "chat_skill_md"
  | "chat_skill_update_md";

function formatLlmLogTime(at: number): string {
  return new Date(at).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function LlmCallLogMetaLine({ e }: { e: LlmCallLogEntry }) {
  const parts: string[] = [];
  if (e.model) parts.push(e.model);
  if (typeof e.durationMs === "number") parts.push(`${e.durationMs} ms`);
  if (e.inputTokens != null || e.outputTokens != null) {
    parts.push(`tokens 入 ${e.inputTokens ?? "—"} / 出 ${e.outputTokens ?? "—"}`);
  }
  if (e.responseMode) parts.push(e.responseMode === "json_object" ? "JSON" : "文本");
  if (e.finishReason) parts.push(`finish: ${e.finishReason}`);
  if (!parts.length) return null;
  return <div className="llm-call-log-meta muted small">{parts.join(" · ")}</div>;
}

function downloadCoreMemoryMd(): void {
  const body = `${getCoreMemoryText().trim()}\n`;
  const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "核心记忆模块.md";
  a.click();
  URL.revokeObjectURL(url);
}

export function AppConfigModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { setUser } = useTasks();
  const [tab, setTab] = useState<ConfigTab>("llm");
  const [apiKey, setApiKey] = useState("");
  const [llmHint, setLlmHint] = useState<string | null>(null);
  const [orgText, setOrgText] = useState("");
  const [orgHint, setOrgHint] = useState<string | null>(null);
  const [webhookRows, setWebhookRows] = useState<{ key: string; url: string }[]>(() =>
    getSmartsheetWebhookRowsForEditor(),
  );
  const [taskFieldIds, setTaskFieldIds] = useState<Record<TaskSmartsheetFieldKey, string>>(() =>
    loadTaskSmartsheetFieldIds(),
  );
  const [smartsheetHint, setSmartsheetHint] = useState<string | null>(null);
  const [llmLogs, setLlmLogs] = useState<LlmCallLogEntry[]>([]);
  const [draftHistoryMd, setDraftHistoryMd] = useState("");
  const [draftCoreMd, setDraftCoreMd] = useState("");
  const [draftSkillMd, setDraftSkillMd] = useState("");
  const [draftSkillUpdateMd, setDraftSkillUpdateMd] = useState("");

  const refreshLlmLogs = useCallback(() => {
    setLlmLogs(readLlmCallLogs());
  }, []);

  useEffect(() => {
    if (!open) return;
    setTab("llm");
    setOrgHint(null);
    setSmartsheetHint(null);
    const existing = getStoredDeepseekApiKey();
    setApiKey(existing ?? "");
    setLlmHint(
      existing ? `当前已保存 Key（末尾 ${existing.slice(-4)}），可覆盖或清除。` : null,
    );
    setOrgText(getOrgStructureText());
    setWebhookRows(getSmartsheetWebhookRowsForEditor());
    setTaskFieldIds(loadTaskSmartsheetFieldIds());
    refreshLlmLogs();
    setDraftHistoryMd(readAssistantHistoryMarkdownFile());
    setDraftCoreMd(getCoreMemoryText());
    setDraftSkillMd(getAiChatSkillMarkdown());
    setDraftSkillUpdateMd(readSkillUpdateMarkdown());
  }, [open, refreshLlmLogs]);

  useEffect(() => {
    if (!open) return;
    const onLog = () => refreshLlmLogs();
    window.addEventListener(LLM_CALL_LOG_CHANGED_EVENT, onLog);
    return () => window.removeEventListener(LLM_CALL_LOG_CHANGED_EVENT, onLog);
  }, [open, refreshLlmLogs]);

  if (!open) return null;

  const isMdTab =
    tab === "history_md" ||
    tab === "core_memory_md" ||
    tab === "chat_skill_md" ||
    tab === "chat_skill_update_md" ||
    tab === "llm_logs";

  function saveLlm() {
    const t = apiKey.trim();
    if (!t) {
      clearStoredDeepseekApiKey();
      onClose();
      return;
    }
    setStoredDeepseekApiKey(t);
    onClose();
  }

  function saveSmartsheet() {
    const err = saveSmartsheetWebhookRowsFromEditor(webhookRows);
    if (err) {
      alert(err);
      return;
    }
    const errIds = saveTaskSmartsheetFieldIds(taskFieldIds);
    if (errIds) {
      alert(errIds);
      return;
    }
    setSmartsheetHint(
      "已保存 Webhook 与各列字段 id（仅本机浏览器）。新建任务保存后会自动向 task 对应地址推送；控制台可查看「[smartsheet] 开始推送」日志。",
    );
  }

  function saveOrg() {
    const r = parseOrgStructureUserInput(orgText);
    if (!r.ok) {
      alert(r.error);
      return;
    }
    setOrgStructureText(r.linesText);
    setOrgText(r.linesText);
    if (r.suggestedPerspective) {
      setUser({ perspective: r.suggestedPerspective });
    }
    if (r.ignoredPerspective) {
      alert(
        `部门架构已保存。JSON 中的视角「${r.ignoredPerspective}」不在新架构对应的下拉选项中，未修改当前视角；请在顶部「当前视角」中手动选择。`,
      );
    }
    setOrgHint(
      r.suggestedPerspective
        ? `部门架构已保存。当前视角已更新为「${r.suggestedPerspective}」。`
        : "部门架构已保存。",
    );
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className={`modal app-config-modal${isMdTab ? " app-config-modal--md" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-config-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="app-config-modal-head">
          <h3 id="app-config-title">系统配置</h3>
          <button
            type="button"
            className="app-config-modal-close"
            onClick={onClose}
            aria-label="关闭"
            title="关闭"
          >
            ✕
          </button>
        </div>

        <div className="app-config-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "llm"}
            className={`app-config-tab${tab === "llm" ? " is-active" : ""}`}
            onClick={() => setTab("llm")}
          >
            大模型 Key
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "llm_logs"}
            className={`app-config-tab${tab === "llm_logs" ? " is-active" : ""}`}
            onClick={() => {
              setTab("llm_logs");
              refreshLlmLogs();
            }}
          >
            LLM 调用记录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "org"}
            className={`app-config-tab${tab === "org" ? " is-active" : ""}`}
            onClick={() => setTab("org")}
          >
            部门架构
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "smartsheet"}
            className={`app-config-tab${tab === "smartsheet" ? " is-active" : ""}`}
            onClick={() => setTab("smartsheet")}
          >
            智能表格推送
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "history_md"}
            className={`app-config-tab${tab === "history_md" ? " is-active" : ""}`}
            onClick={() => setTab("history_md")}
          >
            history.md
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "core_memory_md"}
            className={`app-config-tab${tab === "core_memory_md" ? " is-active" : ""}`}
            onClick={() => setTab("core_memory_md")}
          >
            核心记忆.md
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "chat_skill_md"}
            className={`app-config-tab${tab === "chat_skill_md" ? " is-active" : ""}`}
            onClick={() => setTab("chat_skill_md")}
          >
            chat_skill.md
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "chat_skill_update_md"}
            className={`app-config-tab${tab === "chat_skill_update_md" ? " is-active" : ""}`}
            onClick={() => setTab("chat_skill_update_md")}
          >
            chat_skill_update.md
          </button>
        </div>

        <div className="app-config-body">
          {tab === "llm" && (
            <div className="app-config-panel" role="tabpanel">
              <p className="muted small app-config-intro">
                保存后，系统内所有大模型请求均通过 DeepSeek 开放接口（<code>deepseek-chat</code>
                ，OpenAI 兼容 <code>/v1/chat/completions</code>）发起。Key 仅保存在本机浏览器{" "}
                <code>localStorage</code>，请勿在公共电脑使用。
              </p>
              {llmHint && <p className="report-hint">{llmHint}</p>}
              <label className="llm-key-label">
                API Key
                <input
                  type="password"
                  autoComplete="off"
                  placeholder="sk-…"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </label>
              <div className="llm-modal-actions">
                <button type="button" className="ghost-btn" onClick={() => setApiKey("")}>
                  清空输入
                </button>
                <button
                  type="button"
                  className="ghost-btn danger-outline"
                  onClick={() => {
                    clearStoredDeepseekApiKey();
                    setApiKey("");
                    setLlmHint(null);
                    onClose();
                  }}
                >
                  清除已保存 Key
                </button>
                <button type="button" className="primary-btn" onClick={saveLlm}>
                  保存
                </button>
              </div>
            </div>
          )}

          {tab === "llm_logs" && (
            <div className="app-config-panel app-config-panel--llm-logs" role="tabpanel">
              <p className="muted small app-config-intro">
                每次调用大模型（助手流水线、日报提取、数据中台清洗等）会追加一条记录，保存在本机浏览器。最多保留最近 60 次；单字段过长会截断并注明原始长度。
              </p>
              <div className="app-config-md-toolbar llm-call-log-toolbar">
                <button
                  type="button"
                  className="ghost-btn danger-outline"
                  onClick={() => {
                    if (llmLogs.length === 0 || window.confirm("确定清空全部 LLM 调用记录？")) {
                      clearLlmCallLogs();
                      refreshLlmLogs();
                    }
                  }}
                >
                  清空记录
                </button>
                <button type="button" className="linkish app-config-md-download" onClick={() => refreshLlmLogs()}>
                  刷新
                </button>
              </div>
              {llmLogs.length === 0 ? (
                <p className="muted small">暂无调用记录。发起一次对话或提取后即可在此查看。</p>
              ) : (
                <div className="llm-call-log-timeline" aria-label="LLM 调用时间线">
                  {llmLogs.map((e) => (
                    <article key={e.id} className="llm-call-log-card">
                      <div className="llm-call-log-card-head">
                        <time className="llm-call-log-time" dateTime={new Date(e.at).toISOString()}>
                          {formatLlmLogTime(e.at)}
                        </time>
                        {e.error && <span className="llm-call-log-error-badge">{e.error}</span>}
                      </div>
                      <LlmCallLogMetaLine e={e} />
                      <div className="llm-call-log-sub llm-call-log-sub--in">
                        <div className="llm-call-log-sub-head">输入</div>
                        <pre className="llm-call-log-sub-pre" tabIndex={0}>
                          {e.inputText}
                        </pre>
                      </div>
                      <div
                        className={`llm-call-log-sub llm-call-log-sub--out${e.error ? " llm-call-log-sub--out-error" : ""}`}
                      >
                        <div className="llm-call-log-sub-head">输出</div>
                        <pre className="llm-call-log-sub-pre" tabIndex={0}>
                          {e.outputText || (e.error ? "（无模型正文）" : "（空）")}
                        </pre>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "org" && (
            <div className="app-config-panel" role="tabpanel">
              <p className="muted small app-config-intro">
                支持<strong>每行一条</strong>架构路径（如 <code>一级.二级.三级</code>），或贴入<strong>JSON</strong>：可使用{" "}
                <code>structure</code> 树（每项 <code>name</code>、可选 <code>children</code>，与 <code>company_name</code> 同级的公司架构格式），保存后展开为点分路径；亦支持 <code>lines</code> 等扁平数组。可选{" "}
                <code>currentPerspective</code> / <code>perspective</code> / <code>当前视角</code>（须与顶部视角选项一致，保存后自动同步）。
              </p>
              <label className="org-structure-label">
                <span className="sr-only">部门架构</span>
                <textarea
                  className="org-structure-textarea"
                  rows={16}
                  value={orgText}
                  onChange={(e) => {
                    setOrgText(e.target.value);
                    setOrgHint(null);
                  }}
                  spellCheck={false}
                />
              </label>
              {orgHint && <p className="report-hint">{orgHint}</p>}
              <div className="llm-modal-actions">
                <button type="button" className="primary-btn" onClick={saveOrg}>
                  保存
                </button>
              </div>
            </div>
          )}

          {tab === "smartsheet" && (
            <div className="app-config-panel" role="tabpanel">
              <p className="muted small app-config-intro">
                不同<strong>业务数据</strong>可对应<strong>不同</strong>的智能表格 Webhook。每行一条：「业务标识」用于程序内区分（须唯一），「Webhook
                URL」为企业微信文档提供的<strong>完整地址</strong>（含 <code>key=</code>）。仅保存在本机 <code>localStorage</code>。
                开发环境（<code>npm run dev</code>）经 Vite 代理 <code>/api/qy-wedoc</code> 转发至{" "}
                <code>qyapi.weixin.qq.com</code>；生产建议同源后端转发。若推送报错 <code>Smartsheet field not found</code>
                ，说明下列「列字段 id」与当前智能表格列不一致，请在企业微信文档 / 开发者工具中核对后修改并保存。
              </p>
              {smartsheetHint && <p className="report-hint">{smartsheetHint}</p>}
              <details className="app-config-field-ids-details" open>
                <summary className="app-config-field-ids-summary">任务推送：智能表格列字段 id</summary>
                <p className="muted small app-config-field-ids-intro">
                  每张智能表格的列 id 须与<strong>该 Webhook「示例数据」JSON 里的 key</strong>完全一致（常见为短串如 <code>f6SjhW</code>，也可能为纯数字串）。下表须与<strong>当前 task Webhook 所绑定的子表</strong>列一一对应；默认值来自调研文档示例，若报错请从企业微信示例中复制真实 id。
                </p>
                <div className="app-config-field-ids-grid">
                  {TASK_SMARTSHEET_FIELD_KEYS.map((key) => (
                    <label key={key} className="app-config-field-id-row">
                      <span className="app-config-field-id-label">{TASK_SMARTSHEET_FIELD_LABELS[key]}</span>
                      <input
                        className="fld"
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        value={taskFieldIds[key]}
                        onChange={(e) => {
                          const v = e.target.value;
                          setTaskFieldIds((prev) => ({ ...prev, [key]: v }));
                          setSmartsheetHint(null);
                        }}
                      />
                    </label>
                  ))}
                </div>
                <div className="app-config-field-ids-toolbar">
                  <button
                    type="button"
                    className="ghost-btn tiny-btn"
                    onClick={() => {
                      resetTaskSmartsheetFieldIdsToDefaults();
                      setTaskFieldIds(loadTaskSmartsheetFieldIds());
                      setSmartsheetHint("已恢复为文档示例列字段 id。若需持久化请点击下方「保存」。");
                    }}
                  >
                    恢复默认列字段 id
                  </button>
                </div>
              </details>
              <div className="app-config-webhooks-table-wrap">
                <table className="app-config-webhooks-table">
                  <thead>
                    <tr>
                      <th scope="col">业务标识</th>
                      <th scope="col">说明</th>
                      <th scope="col">Webhook URL</th>
                      <th scope="col" className="app-config-webhooks-col-act">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {webhookRows.map((row, index) => {
                      const isTask = row.key === SMARTSHEET_WEBHOOK_PURPOSE_TASK;
                      const label =
                        SMARTSHEET_WEBHOOK_PURPOSE_LABELS[row.key] ??
                        (row.key.trim() ? `自定义：${row.key}` : "（新业务，请填写标识与 URL）");
                      return (
                        <tr key={`${row.key || "new"}-${index}`}>
                          <td>
                            {isTask ? (
                              <code>{SMARTSHEET_WEBHOOK_PURPOSE_TASK}</code>
                            ) : (
                              <input
                                className="fld"
                                type="text"
                                autoComplete="off"
                                spellCheck={false}
                                placeholder="如 report_sync"
                                value={row.key}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setWebhookRows((prev) =>
                                    prev.map((r, i) => (i === index ? { ...r, key: v } : r)),
                                  );
                                  setSmartsheetHint(null);
                                }}
                              />
                            )}
                          </td>
                          <td className="app-config-webhooks-meta">{label}</td>
                          <td>
                            <input
                              className="fld"
                              type="url"
                              autoComplete="off"
                              placeholder="https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=…"
                              value={row.url}
                              onChange={(e) => {
                                const v = e.target.value;
                                setWebhookRows((prev) =>
                                  prev.map((r, i) => (i === index ? { ...r, url: v } : r)),
                                );
                                setSmartsheetHint(null);
                              }}
                            />
                          </td>
                          <td className="app-config-webhooks-col-act">
                            {isTask ? (
                              <span className="muted tiny">—</span>
                            ) : (
                              <button
                                type="button"
                                className="text-btn danger"
                                onClick={() => {
                                  setWebhookRows((prev) => prev.filter((_, i) => i !== index));
                                  setSmartsheetHint(null);
                                }}
                              >
                                删除
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="app-config-webhooks-actions-row">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    setWebhookRows((prev) => [...prev, { key: "", url: "" }]);
                    setSmartsheetHint(null);
                  }}
                >
                  添加 Webhook
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    setWebhookRows(getSmartsheetWebhookRowsForEditor());
                    setSmartsheetHint(null);
                  }}
                >
                  恢复已保存
                </button>
                <button type="button" className="primary-btn" onClick={saveSmartsheet}>
                  保存
                </button>
              </div>
            </div>
          )}

          {tab === "history_md" && (
            <div className="app-config-panel app-config-panel--md" role="tabpanel">
              <p className="muted small app-config-intro">
                AI 助手交互压缩历史（浏览器 localStorage）。可编辑全文；保存时会解析「远期摘要」与「近期记录」列表写回结构。新对话仍会追加记录。
              </p>
              <div className="app-config-md-toolbar">
                <button type="button" className="linkish app-config-md-download" onClick={() => downloadAssistantHistoryMd()}>
                  下载 history.md
                </button>
                <button
                  type="button"
                  className="primary-btn app-config-md-save"
                  onClick={() => {
                    if (
                      !window.confirm(
                        "确定保存对 history.md 的修改吗？\n将写入本机浏览器存储，并覆盖当前压缩历史对应的结构化数据。",
                      )
                    ) {
                      return;
                    }
                    const r = saveAssistantHistoryMarkdownFromEditor(draftHistoryMd);
                    if (!r.ok) {
                      alert(r.error);
                      return;
                    }
                    setDraftHistoryMd(readAssistantHistoryMarkdownFile());
                  }}
                >
                  保存
                </button>
              </div>
              <textarea
                className="app-config-md-editor"
                value={draftHistoryMd}
                onChange={(e) => setDraftHistoryMd(e.target.value)}
                spellCheck={false}
                aria-label="history.md 正文"
              />
            </div>
          )}

          {tab === "core_memory_md" && (
            <div className="app-config-panel app-config-panel--md" role="tabpanel">
              <p className="muted small app-config-intro">
                AI 助手主题路由使用的<strong>系统常驻知识</strong>。默认与仓库{" "}
                <code>docs/核心记忆模块.md</code>一致；在此编辑并保存后写入本机覆盖；正文清空后保存可恢复为打包默认。
              </p>
              <div className="app-config-md-toolbar">
                <button type="button" className="linkish app-config-md-download" onClick={() => downloadCoreMemoryMd()}>
                  下载 核心记忆模块.md
                </button>
                <button
                  type="button"
                  className="primary-btn app-config-md-save"
                  onClick={() => {
                    if (
                      !window.confirm(
                        "确定保存对《核心记忆模块》的修改吗？\n将写入本机 localStorage，并立即用于助手主题路由等环节。",
                      )
                    ) {
                      return;
                    }
                    setCoreMemoryText(draftCoreMd);
                    setDraftCoreMd(getCoreMemoryText());
                  }}
                >
                  保存
                </button>
              </div>
              <textarea
                className="app-config-md-editor"
                value={draftCoreMd}
                onChange={(e) => setDraftCoreMd(e.target.value)}
                spellCheck={false}
                aria-label="核心记忆模块正文"
              />
            </div>
          )}

          {tab === "chat_skill_md" && (
            <div className="app-config-panel app-config-panel--md" role="tabpanel">
              <p className="muted small app-config-intro">
                各环节中使用的 system 提示词（含询问与操作路径）。默认来自仓库 <code>docs/ai_chat_skill.md</code>；保存后写入 localStorage 全文。请勿删除必要的{" "}
                <code>##</code> 章节标题，以免解析异常。
              </p>
              <div className="app-config-md-toolbar">
                <button type="button" className="linkish app-config-md-download" onClick={() => downloadAiChatSkillMd()}>
                  下载 chat_skill.md
                </button>
                <button
                  type="button"
                  className="primary-btn app-config-md-save"
                  onClick={() => {
                    const shapeWarn = validateAiChatSkillMarkdownShape(draftSkillMd);
                    const msg = shapeWarn
                      ? `${shapeWarn}\n\n仍要保存吗？`
                      : "确定保存对 chat_skill.md 的修改吗？\n将写入本机 localStorage，并立即用于 AI 助手各环节。";
                    if (!window.confirm(msg)) return;
                    setAiChatSkillMarkdown(draftSkillMd);
                    setDraftSkillMd(getAiChatSkillMarkdown());
                  }}
                >
                  保存
                </button>
              </div>
              <textarea
                className="app-config-md-editor"
                value={draftSkillMd}
                onChange={(e) => setDraftSkillMd(e.target.value)}
                spellCheck={false}
                aria-label="chat_skill.md 正文"
              />
            </div>
          )}

          {tab === "chat_skill_update_md" && (
            <div className="app-config-panel app-config-panel--md" role="tabpanel">
              <p className="muted small app-config-intro">
                助手环节「优化」修订提示词生成的变更摘要与节选。可直接编辑保存；之后若再次执行「优化」，可能会用新生成的内容覆盖此处镜像。
              </p>
              <div className="app-config-md-toolbar">
                <button type="button" className="linkish app-config-md-download" onClick={() => downloadSkillUpdateMd()}>
                  下载 chat_skill_update.md
                </button>
                <button
                  type="button"
                  className="primary-btn app-config-md-save"
                  onClick={() => {
                    if (
                      !window.confirm(
                        "确定保存对 chat_skill_update.md 的修改吗？\n将写入本机展示用镜像；与后台 JSON 修订日志可能不一致。",
                      )
                    ) {
                      return;
                    }
                    saveSkillUpdateMarkdownFromEditor(draftSkillUpdateMd);
                    setDraftSkillUpdateMd(readSkillUpdateMarkdown());
                  }}
                >
                  保存
                </button>
              </div>
              <textarea
                className="app-config-md-editor"
                value={draftSkillUpdateMd}
                onChange={(e) => setDraftSkillUpdateMd(e.target.value)}
                spellCheck={false}
                aria-label="chat_skill_update.md 正文"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
