import { useEffect, useState } from "react";
import {
  clearStoredDeepseekApiKey,
  getStoredDeepseekApiKey,
  setStoredDeepseekApiKey,
} from "../utils/llmExtract";

export function LlmKeyConfigModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [value, setValue] = useState("");
  const [savedHint, setSavedHint] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const existing = getStoredDeepseekApiKey();
    setValue(existing ?? "");
    setSavedHint(
      existing ? `当前已保存 Key（末尾 ${existing.slice(-4)}），可覆盖或清除。` : null,
    );
  }, [open]);

  if (!open) return null;

  function save() {
    const t = value.trim();
    if (!t) {
      clearStoredDeepseekApiKey();
      onClose();
      return;
    }
    setStoredDeepseekApiKey(t);
    onClose();
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal llm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="llm-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="llm-modal-title">DeepSeek API Key</h3>
        <p className="muted small">
          保存后，系统内所有大模型请求均通过 DeepSeek 开放接口（<code>deepseek-chat</code>
          ，OpenAI 兼容 <code>/v1/chat/completions</code>）发起。Key 仅保存在本机浏览器{" "}
          <code>localStorage</code>，请勿在公共电脑使用。
        </p>
        {savedHint && <p className="report-hint">{savedHint}</p>}
        <label className="llm-key-label">
          API Key
          <input
            type="password"
            autoComplete="off"
            placeholder="sk-…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <div className="llm-modal-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="ghost-btn" onClick={() => setValue("")}>
            清空输入
          </button>
          <button
            type="button"
            className="ghost-btn danger-outline"
            onClick={() => {
              clearStoredDeepseekApiKey();
              setValue("");
              setSavedHint(null);
              onClose();
            }}
          >
            清除已保存 Key
          </button>
          <button type="button" className="primary-btn" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
