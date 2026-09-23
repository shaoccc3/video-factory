import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

/**
 * 行銷短影音全流程：登入 → 建立任務 → 確認分鏡 → 等待成片 → 審核通過 → 可下載。
 * 需要後端（建議 PROVIDER_MODE=mock，不產生費用）與前端 dev server 已啟動。
 */

const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "admin-pass-123";
const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR ?? "/tmp/e2e";
const TOPIC = "清晨的茶園，推廣自家綠茶";
const FAILED_STATUSES = new Set(["failed", "cancelled", "budget_exceeded", "rejected"]);

let step = 0;
async function snap(page: Page, name: string) {
  step += 1;
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: join(SCREENSHOT_DIR, `${String(step).padStart(2, "0")}-${name}.png`),
    fullPage: true,
  });
}

interface JobState {
  status: string;
  error_message: string | null;
  allowed_actions: string[];
}

/** 直接查 API 等待狀態（頁面同時靠 SSE 更新），遇到失敗狀態立即中止 */
async function waitForStatus(
  request: APIRequestContext,
  jobId: string,
  target: string,
  timeoutMs: number,
): Promise<JobState> {
  const deadline = Date.now() + timeoutMs;
  let last: JobState | null = null;
  while (Date.now() < deadline) {
    const res = await request.get(`/api/v1/jobs/${jobId}`);
    expect(res.ok(), `GET /jobs/${jobId} → ${res.status()}`).toBeTruthy();
    last = (await res.json()) as JobState;
    if (last.status === target) return last;
    if (FAILED_STATUSES.has(last.status)) {
      throw new Error(`任務進入 ${last.status}：${last.error_message ?? ""}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`等待 ${target} 逾時，最後狀態：${last?.status ?? "未知"}`);
}

test("行銷短影音：建立 → 確認分鏡 → 成片 → 審核通過 → 下載", async ({ page }) => {
  // 1. 登入
  await page.goto("/login");
  await page.getByLabel("電子郵件").fill(EMAIL);
  await page.getByLabel("密碼").fill(PASSWORD);
  await snap(page, "login");
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/jobs/);
  await expect(page.getByRole("heading", { name: "任務列表" })).toBeVisible();
  await snap(page, "jobs");

  // 2. 找出 key=marketing 的模板名稱（頁面顯示名稱，不顯示 key）
  const templatesRes = await page.request.get("/api/v1/templates");
  expect(templatesRes.ok()).toBeTruthy();
  const templates = (await templatesRes.json()) as { key: string; name: string }[];
  const marketing = templates.find((t) => t.key === "marketing");
  expect(marketing, "找不到 key 為 marketing 的模板").toBeTruthy();
  const templateName = marketing?.name ?? "";

  // 3. 新建任務精靈
  const title = `E2E 綠茶 ${Date.now()}`;
  await page.getByRole("button", { name: /新建任務/ }).click();
  await page.getByRole("radio", { name: templateName }).click();
  await snap(page, "wizard-template");
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByLabel("任務標題").fill(title);
  await page.getByLabel("主題").fill(TOPIC);
  await snap(page, "wizard-inputs");
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByLabel("目標時長")).toBeVisible();
  await snap(page, "wizard-settings");
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByText(TOPIC)).toBeVisible();
  await snap(page, "wizard-confirm");
  await page.getByRole("button", { name: "建立並提交" }).click();

  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
  const jobId = page.url().split("/").pop() ?? "";
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await snap(page, "job-submitted");

  // 4. 等待分鏡生成
  await waitForStatus(page.request, jobId, "storyboard_ready", 3 * 60_000);
  const status = page.getByTestId("job-status");
  await expect(status).toHaveAttribute("data-status", "storyboard_ready", { timeout: 30_000 });
  await expect(page.getByTestId("scene-editor-0")).toBeVisible();
  await snap(page, "storyboard-ready");

  // 5. 確認分鏡
  await page.getByRole("button", { name: /確認生成/ }).click();
  await page.getByRole("button", { name: "確定" }).click();
  await expect(status).not.toHaveAttribute("data-status", "storyboard_ready");
  await snap(page, "generating");

  // 6. 等待合成完成、進入審核
  await waitForStatus(page.request, jobId, "in_review", 3 * 60_000);
  await page.reload();
  await expect(status).toHaveAttribute("data-status", "in_review");
  const finalVideo = page.getByTestId("final-video");
  await expect(finalVideo).toBeVisible();
  await expect(page.getByTestId("download-final")).toHaveCount(0);
  await snap(page, "in-review");

  // 7. 同一個 admin（也有 reviewer 角色）到審核台審核
  await page.goto("/reviews");
  await expect(page.getByRole("heading", { name: "審核台" })).toBeVisible();
  await page.getByRole("link", { name: title }).click();
  await expect(page.getByTestId("final-video")).toBeVisible();
  const approve = page.getByRole("button", { name: /通過/ });
  await expect(approve).toBeDisabled();
  for (const label of [
    "AI 生成標識存在（片頭與角落）",
    "無未授權真人肖像",
    "無第三方品牌或影視 IP",
    "符合品牌規範",
    "字幕無錯字",
  ]) {
    await page.getByRole("checkbox", { name: label }).check();
  }
  await snap(page, "review-checklist");
  await expect(approve).toBeEnabled();
  await approve.click();

  // 8. 通過後回到任務詳情，出現下載按鈕
  await expect(page).toHaveURL(new RegExp(`/jobs/${jobId}$`));
  await expect(status).toHaveAttribute("data-status", "approved");
  const download = page.getByTestId("download-final");
  await expect(download).toBeVisible();
  await expect(download).toHaveAttribute("href", /\/api\/v1\/assets\/.+\/download$/);
  await snap(page, "approved");
});
