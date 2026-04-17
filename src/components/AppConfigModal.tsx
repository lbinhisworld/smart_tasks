import { useEffect, useState } from "react";
import {
  clearStoredDeepseekApiKey,
  getStoredDeepseekApiKey,
  setStoredDeepseekApiKey,
} from "../utils/llmExtract";
import { getOrgStructureText, setOrgStructureText } from "../utils/orgStructureStorage";

type ConfigTab = "llm" | "org";

export function AppConfigModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<ConfigTab>("llm");
  const [apiKey, setApiKey] = useState("");
  const [llmHint, setLlmHint] = useState<string | null>(null);
  const [orgText, setOrgText] = useState("");
  const [orgSaved, setOrgSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab("llm");
    setOrgSaved(false);
    const existing = getStoredDeepseekApiKey();
    setApiKey(existing ?? "");
    setLlmHint(
      existing ? `当前已保存 Key（末尾 ${existing.slice(-4)}），可覆盖或清除。` : null,
    );
    setOrgText(getOrgStructureText());
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

  function saveOrg() {
    setOrgStructureText(orgText);
    setOrgSaved(true);
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
                以下为齐峰集团部门与分公司架构（每行一条）。可编辑后点击「保存」写入本机浏览器。
              </p>
              <label className="org-structure-label">
                <span className="sr-only">部门架构</span>
                <textarea
                  className="org-structure-textarea"
                  rows={16}
                  value={orgText}
                  onChange={(e) => {
                    setOrgText(e.target.value);
                    setOrgSaved(false);
                  }}
                  spellCheck={false}
                />
              </label>
              {orgSaved && <p className="report-hint">部门架构已保存。</p>}
              <div className="llm-modal-actions">
                <button type="button" className="primary-btn" onClick={saveOrg}>
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
