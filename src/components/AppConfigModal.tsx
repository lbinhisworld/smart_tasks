import { useEffect, useState } from "react";
import { useTasks } from "../context/TaskContext";
import {
  clearStoredDeepseekApiKey,
  getStoredDeepseekApiKey,
  setStoredDeepseekApiKey,
} from "../utils/llmExtract";
import { HOME_ASSISTANT_CORE_MEMORY } from "../utils/homeAssistantPrompt";
import { readAssistantHistoryMarkdownFile, downloadAssistantHistoryMd } from "../utils/assistantHistoryMd";
import { getAiChatSkillMarkdown, downloadAiChatSkillMd } from "../utils/aiChatSkillStore";
import { readSkillUpdateMarkdown, downloadSkillUpdateMd } from "../utils/aiChatSkillRevision";
import { parseOrgStructureUserInput } from "../utils/orgStructureInput";
import { getOrgStructureText, setOrgStructureText } from "../utils/orgStructureStorage";

type ConfigTab =
  | "llm"
  | "org"
  | "history_md"
  | "core_memory_md"
  | "chat_skill_md"
  | "chat_skill_update_md";

function downloadCoreMemoryMd(): void {
  const body = `${HOME_ASSISTANT_CORE_MEMORY.trim()}\n`;
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

  useEffect(() => {
    if (!open) return;
    setTab("llm");
    setOrgHint(null);
    const existing = getStoredDeepseekApiKey();
    setApiKey(existing ?? "");
    setLlmHint(
      existing ? `当前已保存 Key（末尾 ${existing.slice(-4)}），可覆盖或清除。` : null,
    );
    setOrgText(getOrgStructureText());
  }, [open]);

  if (!open) return null;

  const isMdTab =
    tab === "history_md" ||
    tab === "core_memory_md" ||
    tab === "chat_skill_md" ||
    tab === "chat_skill_update_md";

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
            aria-selected={tab === "org"}
            className={`app-config-tab${tab === "org" ? " is-active" : ""}`}
            onClick={() => setTab("org")}
          >
            部门架构
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

          {tab === "history_md" && (
            <div className="app-config-panel app-config-panel--md" role="tabpanel">
              <p className="muted small app-config-intro">
                AI 助手交互压缩历史（浏览器 localStorage）。关闭弹窗后若有新对话，可再次打开本页刷新内容。
              </p>
              <div className="app-config-md-toolbar">
                <button type="button" className="linkish app-config-md-download" onClick={() => downloadAssistantHistoryMd()}>
                  下载 history.md
                </button>
              </div>
              <pre className="app-config-md-preview" tabIndex={0}>
                {readAssistantHistoryMarkdownFile()}
              </pre>
            </div>
          )}

          {tab === "core_memory_md" && (
            <div className="app-config-panel app-config-panel--md" role="tabpanel">
              <p className="muted small app-config-intro">
                AI 助手主题路由使用的<strong>系统常驻知识</strong>，来自仓库{" "}
                <code>docs/核心记忆模块.md</code>（构建时打包进前端）。
              </p>
              <div className="app-config-md-toolbar">
                <button type="button" className="linkish app-config-md-download" onClick={() => downloadCoreMemoryMd()}>
                  下载 核心记忆模块.md
                </button>
              </div>
              <pre className="app-config-md-preview" tabIndex={0}>
                {HOME_ASSISTANT_CORE_MEMORY}
              </pre>
            </div>
          )}

          {tab === "chat_skill_md" && (
            <div className="app-config-panel app-config-panel--md" role="tabpanel">
              <p className="muted small app-config-intro">
                四环节大模型 system 提示词（默认来自仓库 <code>docs/ai_chat_skill.md</code>，本地修订存
                localStorage）。
              </p>
              <div className="app-config-md-toolbar">
                <button type="button" className="linkish app-config-md-download" onClick={() => downloadAiChatSkillMd()}>
                  下载 chat_skill.md
                </button>
              </div>
              <pre className="app-config-md-preview" tabIndex={0}>
                {getAiChatSkillMarkdown()}
              </pre>
            </div>
          )}

          {tab === "chat_skill_update_md" && (
            <div className="app-config-panel app-config-panel--md" role="tabpanel">
              <p className="muted small app-config-intro">
                通过 AI 助手环节「优化」修订提示词后生成的变更摘要与节选。
              </p>
              <div className="app-config-md-toolbar">
                <button type="button" className="linkish app-config-md-download" onClick={() => downloadSkillUpdateMd()}>
                  下载 chat_skill_update.md
                </button>
              </div>
              <pre className="app-config-md-preview" tabIndex={0}>
                {readSkillUpdateMarkdown()}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
