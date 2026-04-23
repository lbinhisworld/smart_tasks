import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const llmKey = env.LLM_API_KEY?.trim();
  const useOpenAIProxy = env.VITE_LLM_VIA_PROXY === "1" && !!llmKey;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      /** 避免公司代理或浏览器强缓存导致懒加载 chunk 仍指向旧版（如议题列表仍为表格） */
      headers: {
        "Cache-Control": "no-store",
      },
      proxy: {
        /** 企业微信文档智能表格 Webhook（开发环境绕过浏览器 CORS） */
        "/api/qy-wedoc": {
          target: "https://qyapi.weixin.qq.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/qy-wedoc/, "") || "/",
        },
        "/api/deepseek": {
          target: "https://api.deepseek.com",
          changeOrigin: true,
          rewrite: () => "/v1/chat/completions",
        },
        ...(useOpenAIProxy
          ? {
              "/api/llm": {
                target: "https://api.openai.com",
                changeOrigin: true,
                rewrite: () => "/v1/chat/completions",
                configure(proxy) {
                  proxy.on("proxyReq", (proxyReq) => {
                    proxyReq.setHeader("Authorization", `Bearer ${llmKey}`);
                  });
                },
              },
            }
          : {}),
      },
    },
    /** 本地 `vite preview` 与开发环境一致，避免懒加载 chunk 被浏览器磁盘缓存成旧版 */
    preview: {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  };
});
