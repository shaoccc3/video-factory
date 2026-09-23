import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * 管理頁模型配置：單價按 models.yaml 的官方牌價顯示（規格 13）。
 * 需要後端與前端 dev server 已啟動（scripts/dev-local.sh start）。
 */

const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "admin-pass-123";
const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR ?? "/tmp/e2e";

test("管理頁：模型表顯示大模型輸入／輸出單價與影片按解析度單價", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("電子郵件").fill(EMAIL);
  await page.getByLabel("密碼").fill(PASSWORD);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/jobs/);

  await page.goto("/admin?tab=budget");
  await expect(page.getByText("seed-2-0-lite-260428")).toBeVisible();
  await expect(page.getByText("dreamina-seedance-2-5-260628")).toBeVisible();
  await expect(page.getByText("入 0.25／出 2")).toBeVisible();
  await expect(page.getByText("7（1080p 7.7）")).toBeVisible();
  await expect(page.getByText("10.7（1080p 11.7）")).toBeVisible();

  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SCREENSHOT_DIR, "admin-models.png"), fullPage: true });
});
