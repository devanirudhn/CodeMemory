import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiProxyTarget = env.VITE_API_PROXY_TARGET;
  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: apiProxyTarget ? { "/api": apiProxyTarget } : undefined,
    },
  };
});
