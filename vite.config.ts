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
