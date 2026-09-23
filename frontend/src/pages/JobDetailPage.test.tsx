import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { JobDetail } from "../api/types";
import { makeEstimate, makeJob, makeScene, makeUser } from "../test/fixtures";
import { json, mockApi, renderApp } from "../test/utils";

const scenes = [
  makeScene({ id: "s-0", index: 0 }),
  makeScene({ id: "s-1", index: 1, narration: "沖泡綠茶", visual_prompt: "茶杯特寫" }),
];

function storyboardJob(overrides: Partial<JobDetail> = {}): JobDetail {
  return makeJob({
    status: "storyboard_ready",
    scenes,
    progress: { total: 2, succeeded: 0, failed: 0 },
    allowed_actions: ["edit_storyboard", "confirm_storyboard", "regenerate_script", "cancel"],
    ...overrides,
  });
}

function baseRoutes(job: JobDetail) {
  return {
    "GET /auth/me": makeUser(),
    "GET /jobs/job-1": job,
    "GET /jobs/job-1/calls": [],
    "GET /jobs/job-1/estimate": makeEstimate(),
  };
}

describe("分鏡確認", () => {
  it("編輯旁白只 PATCH 改動的欄位，確認生成呼叫 confirm-storyboard", async () => {
    const job = storyboardJob();
    const api = mockApi({
      ...baseRoutes(job),
      "PATCH /jobs/job-1/scenes/s-0": (call: { body: unknown }) => ({
        ...job,
        scenes: [{ ...scenes[0], ...(call.body as object) }, scenes[1]],
      }),
      "POST /jobs/job-1/confirm-storyboard": { ...job, status: "generating", allowed_actions: [] },
    });
    renderApp("/jobs/job-1");

    const card = await screen.findByTestId("scene-editor-0");
    const narration = within(card).getByLabelText("旁白");
    await userEvent.clear(narration);
    await userEvent.type(narration, "晨霧裡的茶園");
    await userEvent.click(within(card).getByRole("button", { name: /儲存此鏡頭/ }));

    await waitFor(() => expect(api.find("PATCH", "/jobs/job-1/scenes/s-0")).toHaveLength(1));
    expect(api.find("PATCH", "/jobs/job-1/scenes/s-0")[0]?.body).toEqual({
      narration: "晨霧裡的茶園",
    });

    // 成本預估面板
    expect(await screen.findByText("¥12.50")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /確認生成/ }));
    await userEvent.click(await screen.findByRole("button", { name: "確定" }));
    await waitFor(() => expect(api.find("POST", "/jobs/job-1/confirm-storyboard")).toHaveLength(1));
    expect(await screen.findByTestId("job-status")).toHaveAttribute("data-status", "generating");
  });

  it("allowed_actions 不含編輯與確認時，欄位唯讀且不顯示按鈕", async () => {
    mockApi(baseRoutes(storyboardJob({ allowed_actions: [] })));
    renderApp("/jobs/job-1");
    const card = await screen.findByTestId("scene-editor-0");
    expect(within(card).getByLabelText("旁白")).toBeDisabled();
    expect(screen.getByText("目前不可編輯分鏡")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /儲存此鏡頭/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /確認生成/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /重新生成腳本/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /取消任務/ })).not.toBeInTheDocument();
  });

  it("只有確認權限時可確認但不可編輯", async () => {
    mockApi(baseRoutes(storyboardJob({ allowed_actions: ["confirm_storyboard"] })));
    renderApp("/jobs/job-1");
    await screen.findByTestId("scene-editor-0");
    expect(screen.getByRole("button", { name: /確認生成/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /儲存此鏡頭/ })).not.toBeInTheDocument();
  });

  it("超預算時顯示警告，確認回 409 時提示調整", async () => {
    const job = storyboardJob();
    mockApi({
      ...baseRoutes(job),
      "GET /jobs/job-1/estimate": makeEstimate({ within_budget: false, total_cny: 80 }),
      "POST /jobs/job-1/confirm-storyboard": json(409, { detail: "超出單任務預算" }),
    });
    renderApp("/jobs/job-1");
    expect(await screen.findByText("預估超出預算，無法確認生成")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /確認生成/ }));
    await userEvent.click(await screen.findByRole("button", { name: "確定" }));
    expect(await screen.findByText("超出單任務預算")).toBeInTheDocument();
    expect(screen.getByText(/預估成本超出預算/)).toBeInTheDocument();
  });
});

describe("任務詳情", () => {
  it("區分內容審核錯誤與系統錯誤", async () => {
    mockApi(
      baseRoutes(
        makeJob({
          status: "failed",
          error_kind: "moderation",
          error_code: "InputTextSensitiveContentDetected",
          error_message: "輸入包含敏感內容",
          allowed_actions: ["resume"],
        }),
      ),
    );
    renderApp("/jobs/job-1");
    expect(await screen.findByTestId("job-error-moderation")).toHaveTextContent("內容審核未通過");
    expect(screen.getByText(/輸入包含敏感內容/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /續跑/ })).toBeInTheDocument();
  });

  it("系統錯誤顯示為系統錯誤", async () => {
    mockApi(
      baseRoutes(makeJob({ status: "failed", error_kind: "timeout", error_message: "輪詢逾時" })),
    );
    renderApp("/jobs/job-1");
    expect(await screen.findByTestId("job-error-system")).toHaveTextContent("系統錯誤");
  });

  it("生成中顯示分鏡預覽與重做按鈕；成片沒有 download 動作時不顯示下載", async () => {
    const job = makeJob({
      status: "in_review",
      final_asset_id: "final-1",
      cover_asset_id: "cover-1",
      scenes: [makeScene({ status: "succeeded", video_asset_id: "clip-0", attempt: 1 })],
      allowed_actions: ["review", "regenerate_scene"],
    });
    const api = mockApi({
      ...baseRoutes(job),
      "POST /jobs/job-1/scenes/s-0/regenerate": { ...job, allowed_actions: [] },
    });
    renderApp("/jobs/job-1");
    expect(await screen.findByTestId("final-video")).toHaveAttribute(
      "src",
      "/api/v1/assets/final-1/content",
    );
    expect(screen.queryByTestId("download-final")).not.toBeInTheDocument();
    expect(screen.getByText("審核通過後才可下載")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /審核/ })).toBeInTheDocument();

    const preview = screen.getByTestId("scene-preview-0");
    expect(preview.querySelector("video")).toHaveAttribute("src", "/api/v1/assets/clip-0/content");
    await userEvent.click(within(preview).getByRole("button", { name: /重做/ }));
    await userEvent.click(await screen.findByRole("button", { name: "確定" }));
    await waitFor(() =>
      expect(api.find("POST", "/jobs/job-1/scenes/s-0/regenerate")[0]?.body).toEqual({
        target: "video",
      }),
    );
  });

  it("有 download 動作時顯示下載連結", async () => {
    mockApi(
      baseRoutes(
        makeJob({ status: "approved", final_asset_id: "final-1", allowed_actions: ["download"] }),
      ),
    );
    renderApp("/jobs/job-1");
    expect(await screen.findByTestId("download-final")).toHaveAttribute(
      "href",
      "/api/v1/assets/final-1/download",
    );
  });

  it("SSE 推送的 JobDetail 會即時更新頁面", async () => {
    const sources: { url: string; target: EventTarget }[] = [];
    class FakeEventSource extends EventTarget {
      constructor(
        public url: string,
        public init?: EventSourceInit,
      ) {
        super();
        sources.push({ url, target: this });
      }
      close() {}
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    mockApi(baseRoutes(makeJob({ status: "scripting" })));
    renderApp("/jobs/job-1");
    expect(await screen.findByTestId("job-status")).toHaveAttribute("data-status", "scripting");
    await waitFor(() => expect(sources.length).toBeGreaterThan(0));
    expect(sources[0]?.url).toBe("/api/v1/jobs/job-1/events");

    act(() => {
      for (const s of sources) {
        s.target.dispatchEvent(
          new MessageEvent("job", {
            data: JSON.stringify(storyboardJob({ allowed_actions: ["confirm_storyboard"] })),
          }),
        );
      }
    });
    expect(await screen.findByTestId("scene-editor-1")).toBeInTheDocument();
    expect(screen.getByTestId("job-status")).toHaveAttribute("data-status", "storyboard_ready");
  });
});
