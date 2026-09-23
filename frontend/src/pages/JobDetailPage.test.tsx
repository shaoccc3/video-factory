import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { JobDetail } from "../api/types";
import { makeEstimate, makeJob, makeMeta, makeScene, makeUser } from "../test/fixtures";
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

const SAVE_WAIT = { timeout: 3000 };

describe("分鏡表", () => {
  it("改旁白：監看字幕即時更新，停止輸入後自動儲存且只 PATCH 改動的欄位；確認開拍呼叫 confirm-storyboard", async () => {
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
    expect(screen.getByTestId("monitor-subtitle")).toHaveTextContent("清晨的茶園");
    const narration = within(card).getByLabelText("旁白");
    await userEvent.clear(narration);
    await userEvent.type(narration, "晨霧裡的茶園");
    expect(screen.getByTestId("monitor-subtitle")).toHaveTextContent("晨霧裡的茶園");
    expect(within(card).getByTestId("save-status")).toHaveTextContent("編輯中");

    await waitFor(
      () => expect(api.find("PATCH", "/jobs/job-1/scenes/s-0")).toHaveLength(1),
      SAVE_WAIT,
    );
    expect(api.find("PATCH", "/jobs/job-1/scenes/s-0")[0]?.body).toEqual({
      narration: "晨霧裡的茶園",
    });
    expect(await within(card).findByText("已自動儲存")).toBeInTheDocument();

    // 頁頭的預估
    expect(screen.getByText("≈ ¥12.50")).toBeInTheDocument();
    expect(screen.getByText("單任務預算 ¥50.00 · 今日 ¥10.00 / ¥300.00")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /確認開拍/ }));
    await userEvent.click(await screen.findByRole("button", { name: "確定" }));
    await waitFor(() => expect(api.find("POST", "/jobs/job-1/confirm-storyboard")).toHaveLength(1));
    expect(await screen.findByTestId("job-status")).toHaveAttribute("data-status", "generating");
  });

  it("旁白顯示字數與建議上限（時長 × chars_per_second），時長用 ± 調整且受模型範圍限制", async () => {
    const job = storyboardJob({ shot_duration_s: { min_s: 4, max_s: 8 } });
    const api = mockApi({
      ...baseRoutes(job),
      "GET /meta": makeMeta({ chars_per_second: 3.5 }),
      "PATCH /jobs/job-1/scenes/s-0": job,
    });
    renderApp("/jobs/job-1");

    const card = await screen.findByTestId("scene-editor-0");
    // 5 秒 × 3.5 = 17.5 → 建議上限 17 字；「清晨的茶園」5 字
    const counter = await within(card).findByTestId("narration-count-0");
    await waitFor(() => expect(counter).toHaveTextContent("5／建議上限 17 字"));
    expect(counter).toHaveAttribute("data-over", "false");

    const narration = within(card).getByLabelText("旁白");
    await userEvent.clear(narration);
    await userEvent.type(narration, "晨霧裡的茶園，陽光慢慢灑落在每一片嫩綠的葉子上");
    expect(counter).toHaveTextContent("23／建議上限 17 字");
    expect(counter).toHaveAttribute("data-over", "true");
    expect(counter).toHaveTextContent("超過建議上限");

    // 時長拉長後上限跟著變；到模型上限 8 秒就不能再加
    const longer = within(card).getByRole("button", { name: "加長 1 秒" });
    for (let i = 0; i < 3; i += 1) await userEvent.click(longer);
    expect(within(card).getByLabelText("時長")).toHaveTextContent("8S");
    expect(longer).toBeDisabled();
    expect(counter).toHaveTextContent("23／建議上限 28 字");
    expect(counter).toHaveAttribute("data-over", "false");
    expect(within(card).getByText("4～8 秒（依影片模型）")).toBeInTheDocument();
    const shorter = within(card).getByRole("button", { name: "縮短 1 秒" });
    for (let i = 0; i < 3; i += 1) await userEvent.click(shorter);
    expect(counter).toHaveAttribute("data-over", "true");

    // 超過建議上限不阻擋儲存；時長改回原值就不送
    await waitFor(
      () => expect(api.find("PATCH", "/jobs/job-1/scenes/s-0")).toHaveLength(1),
      SAVE_WAIT,
    );
    expect(api.find("PATCH", "/jobs/job-1/scenes/s-0")[0]?.body).toEqual({
      narration: "晨霧裡的茶園，陽光慢慢灑落在每一片嫩綠的葉子上",
    });
  });

  it("點時間軸切換鏡頭；切換前的修改不會丟失，兩鏡各自只 PATCH 改動的欄位", async () => {
    const job = storyboardJob();
    const api = mockApi({
      ...baseRoutes(job),
      "PATCH /jobs/job-1/scenes/s-0": job,
      "PATCH /jobs/job-1/scenes/s-1": job,
    });
    renderApp("/jobs/job-1");

    const first = await screen.findByTestId("scene-editor-0");
    await userEvent.type(within(first).getByLabelText("音效"), "鳥鳴");
    await userEvent.click(screen.getByTestId("clip-1"));
    expect(screen.getByTestId("clip-1")).toHaveAttribute("aria-pressed", "true");

    const second = await screen.findByTestId("scene-editor-1");
    expect(screen.getByText(/SHOT 02 · 遠景/)).toBeInTheDocument();
    const speaker = within(second).getByLabelText("說話者");
    expect(speaker).toHaveValue("旁白");
    await userEvent.clear(speaker);
    await userEvent.type(speaker, "一位年輕女店員");
    await userEvent.type(within(second).getByLabelText("音效"), "倒茶水聲");

    await waitFor(
      () => expect(api.find("PATCH", "/jobs/job-1/scenes/s-1")).toHaveLength(1),
      SAVE_WAIT,
    );
    expect(api.find("PATCH", "/jobs/job-1/scenes/s-0")[0]?.body).toEqual({ sound: "鳥鳴" });
    expect(api.find("PATCH", "/jobs/job-1/scenes/s-1")[0]?.body).toEqual({
      speaker: "一位年輕女店員",
      sound: "倒茶水聲",
    });
  });

  it("畫面描述空白時就地提示且不儲存", async () => {
    const job = storyboardJob();
    const api = mockApi({ ...baseRoutes(job), "PATCH /jobs/job-1/scenes/s-0": job });
    renderApp("/jobs/job-1");
    const card = await screen.findByTestId("scene-editor-0");
    await userEvent.clear(within(card).getByLabelText("畫面描述"));
    expect(within(card).getByText("請輸入畫面描述")).toBeInTheDocument();
    expect(within(card).getByTestId("save-status")).toHaveTextContent("畫面描述空白，尚未儲存");
    await new Promise((r) => setTimeout(r, 1000));
    expect(api.find("PATCH", "/jobs/job-1/scenes/s-0")).toHaveLength(0);
  });

  it("首幀預覽：按鈕帶單價，送出後鏡頭顯示首幀生成中，完成前不能確認開拍", async () => {
    const withFrames = [
      makeScene({ id: "s-0", index: 0, needs_first_frame: true }),
      makeScene({ id: "s-1", index: 1, needs_first_frame: true }),
    ];
    const job = storyboardJob({
      scenes: withFrames,
      allowed_actions: ["edit_storyboard", "confirm_storyboard", "preview_keyframe"],
    });
    const api = mockApi({
      ...baseRoutes(job),
      "GET /jobs/job-1/estimate": makeEstimate({
        items: [
          {
            label: "關鍵幀（Seedream）",
            model_key: "keyframe",
            quantity: 2,
            unit: "張",
            amount_cny: 0.5,
          },
          { label: "影片", model_key: "video_final", quantity: 10, unit: "秒", amount_cny: 12 },
        ],
      }),
      "POST /jobs/job-1/scenes/s-0/keyframe-preview": {
        ...job,
        scenes: [{ ...withFrames[0], status: "keyframe" }, withFrames[1]],
      },
    });
    renderApp("/jobs/job-1");

    const card = await screen.findByTestId("scene-editor-0");
    expect(
      await screen.findByRole("button", { name: "全部生成首幀（2 鏡） · ¥0.50" }),
    ).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "生成首幀預覽 · ¥0.25" }));
    await waitFor(() =>
      expect(api.find("POST", "/jobs/job-1/scenes/s-0/keyframe-preview")[0]?.body).toEqual({}),
    );
    expect(await within(card).findByText("首幀生成中")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /確認開拍/ })).toBeDisabled();
    expect(screen.getByText(/首幀預覽生成中，完成前不能確認開拍/)).toBeInTheDocument();
  });

  it("allowed_actions 不含編輯與確認時，欄位唯讀且不顯示按鈕", async () => {
    mockApi(baseRoutes(storyboardJob({ allowed_actions: [] })));
    renderApp("/jobs/job-1");
    const card = await screen.findByTestId("scene-editor-0");
    expect(within(card).getByLabelText("旁白")).toBeDisabled();
    expect(screen.getByText("目前不可編輯分鏡")).toBeInTheDocument();
    expect(within(card).queryByTestId("save-status")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /確認開拍/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /重寫分鏡/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /取消任務/ })).not.toBeInTheDocument();
  });

  it("只有確認權限時可確認但不可編輯", async () => {
    mockApi(baseRoutes(storyboardJob({ allowed_actions: ["confirm_storyboard"] })));
    renderApp("/jobs/job-1");
    const card = await screen.findByTestId("scene-editor-0");
    expect(screen.getByRole("button", { name: /確認開拍/ })).toBeInTheDocument();
    expect(within(card).getByLabelText("旁白")).toBeDisabled();
  });

  it("超預算時顯示警告，確認回 409 時就地提示調整", async () => {
    const job = storyboardJob();
    mockApi({
      ...baseRoutes(job),
      "GET /jobs/job-1/estimate": makeEstimate({ within_budget: false, total_cny: 80 }),
      "POST /jobs/job-1/confirm-storyboard": json(409, { detail: "超出單任務預算" }),
    });
    renderApp("/jobs/job-1");
    expect(await screen.findByText("預估超出預算，無法確認生成")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /確認開拍/ }));
    await userEvent.click(await screen.findByRole("button", { name: "確定" }));
    expect(await screen.findByText("超出單任務預算")).toBeInTheDocument();
    expect(screen.getByText(/預估成本超出預算/)).toBeInTheDocument();
  });

  it("技術細節（調用記錄）只有管理員看得到", async () => {
    mockApi({ ...baseRoutes(storyboardJob()), "GET /auth/me": makeUser({ roles: ["creator"] }) });
    renderApp("/jobs/job-1");
    await screen.findByTestId("scene-editor-0");
    expect(screen.queryByRole("button", { name: "技術細節" })).not.toBeInTheDocument();
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

  it("原生聲音任務顯示聲音風格、配樂、聲音一致；分鏡卡片顯示說話者與音效", async () => {
    const job = makeJob({
      status: "generating",
      options: {
        ...makeJob().options,
        audio_mode: "native",
        voice_style: "溫暖的年輕女聲",
        music: "none",
        consistent_voice: true,
      },
      scenes: [
        makeScene({ speaker: "一位年輕女店員", sound: "倒茶水聲" }),
        makeScene({ id: "s-1", index: 1, speaker: "", sound: "" }),
      ],
    });
    mockApi(baseRoutes(job));
    renderApp("/jobs/job-1");
    expect(await screen.findByText("溫暖的年輕女聲")).toBeInTheDocument();
    expect(screen.getByText("none")).toBeInTheDocument();
    expect(screen.getByText("聲音一致（較慢）")).toBeInTheDocument();

    expect(screen.getByTestId("scene-speaker-0")).toHaveTextContent("說話者：一位年輕女店員");
    expect(screen.getByTestId("scene-sound-0")).toHaveTextContent("音效：倒茶水聲");
    expect(screen.queryByTestId("scene-speaker-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("scene-sound-1")).not.toBeInTheDocument();
  });

  it("TTS 任務不顯示原生聲音的設定", async () => {
    mockApi(baseRoutes(makeJob({ status: "generating" })));
    renderApp("/jobs/job-1");
    expect(await screen.findByText("TTS 配音")).toBeInTheDocument();
    expect(screen.queryByText("聲音風格")).not.toBeInTheDocument();
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
    expect(await screen.findByTestId("scene-editor-0")).toBeInTheDocument();
    expect(screen.getByTestId("clip-1")).toBeInTheDocument();
    expect(screen.getByTestId("job-status")).toHaveAttribute("data-status", "storyboard_ready");
  });
});
