import { existsSync } from "node:fs";
import { defineConfig, devices, type LaunchOptions } from "@playwright/test";

// 雲端會話使用預裝的 Chromium；CI 未設定且預設路徑不存在時，交給 Playwright 自己安裝的瀏覽器。
// 注意：不要執行 playwright install。
const DEFAULT_CHROMIUM = "/opt/pw-browsers/chromium";
const executablePath =
  process.env.PW_CHROMIUM ?? (existsSync(DEFAULT_CHROMIUM) ? DEFAULT_CHROMIUM : undefined);

const launchOptions: LaunchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: "./e2e",
  // 行銷短影音全流程含生成與合成，給足時間
  timeout: 8 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    locale: "zh-TW",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    launchOptions,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions } }],
});
