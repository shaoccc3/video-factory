import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// 開發代理的後端位址，預設本機 uvicorn
const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": apiTarget,
      "/healthz": apiTarget,
      "/readyz": apiTarget,
    },
  },
  build: {
    rolldownOptions: {
      output: {
        // 把變動少的第三方庫拆出，業務代碼更新時瀏覽器仍可沿用快取
        codeSplitting: {
          groups: [
            {
              name: "antd",
              test: /node_modules[\\/](antd|@ant-design|@rc-component|rc-[^\\/]+)[\\/]/,
            },
            { name: "vendor", test: /node_modules[\\/]/ },
          ],
        },
      },
    },
    // 內部工具，antd 單獨成塊約 1MB，放寬警告門檻
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // 只跑單元測試；e2e/ 由 Playwright 執行
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
