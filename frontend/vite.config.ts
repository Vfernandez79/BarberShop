import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = process.env.VITE_API_PROXY_TARGET || env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8001";
  const devPort = Number(process.env.VITE_DEV_PORT || process.env.VITE_PORT || env.VITE_DEV_PORT || env.VITE_PORT || "5173");

  return {
    plugins: [react()],
    server: {
      host: "::",
      port: Number.isFinite(devPort) ? devPort : 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
