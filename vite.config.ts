import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const llmKey = env.LLM_API_KEY?.trim();
  const useOpenAIProxy = env.VITE_LLM_VIA_PROXY === "1" && !!llmKey;

  return {
    plugins: [react()],
    server: {
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
  };
});
