import { useEffect, useState } from "react";
import { useTasks } from "../context/TaskContext";
import {
  clearStoredDeepseekApiKey,
  getStoredDeepseekApiKey,
  setStoredDeepseekApiKey,
} from "../utils/llmExtract";
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

type ConfigTab = "llm" | "org" | "smartsheet";

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
  }, [open]);

  if (!open) return null;

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
        className="modal app-config-modal"
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
        </div>
      </div>
    </div>
  );
}
