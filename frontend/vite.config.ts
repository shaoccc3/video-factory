import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * @fontsource 的 CSS 同時列 woff2 與 woff；現代瀏覽器只用 woff2。
 * 去掉 woff 備用來源，避免打包上百個用不到的 woff 檔。
 */
function fontsourceWoff2Only(): Plugin {
  return {
    name: "fontsource-woff2-only",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("@fontsource") || !id.endsWith(".css")) return null;
      return { code: code.replace(/,\s*url\([^)]+\.woff\) format\('woff'\)/g, ""), map: null };
    },
  };
}

// 開發代理的後端位址，預設本機 uvicorn
const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:8000";

export default defineConfig({
  plugins: [fontsourceWoff2Only(), react()],
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
            // 字體宣告只由動態載入的 styles/fonts 引用，單獨成塊才不會被首屏的 vendor 帶進來
            { name: "fonts", test: /node_modules[\\/]@fontsource[\\/]/ },
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
