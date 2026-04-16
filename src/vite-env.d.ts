/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LLM_API_KEY?: string;
  readonly VITE_LLM_API_URL?: string;
  readonly VITE_LLM_MODEL?: string;
  /** 开发环境走 Vite 代理 /api/llm，密钥用根目录 .env 的 LLM_API_KEY（勿加 VITE_ 前缀） */
  readonly VITE_LLM_VIA_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
