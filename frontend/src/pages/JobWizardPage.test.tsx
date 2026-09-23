import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeJob, makeMeta, makeTemplate, makeUser } from "../test/fixtures";
import { json, mockApi, renderApp } from "../test/utils";
import { availableAudioModes, buildJobCreate, defaultAudioMode } from "./JobWizardPage";

const marketing = makeTemplate();
const quick = makeTemplate({
  id: "tpl-quick",
  key: "quick",
  name: "圖文轉短片",
  video_type: "quick",
  ratio: "1:1",
  min_duration_s: 5,
  max_duration_s: 10,
  audio_mode: "none",
});

const estimate = {
  total_cny: 42.5,
  items: [
    { label: "腳本", model_key: "llm", quantity: 1, unit: "次", amount_cny: 0.01 },
    { label: "正片 0:30", model_key: "video", quantity: 30, unit: "秒", amount_cny: 42.49 },
  ],
  budget_per_job_cny: 150,
  within_budget: true,
};

const pressed = (name: RegExp | string) =>
  expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");

describe("開新片（場記板）", () => {
  it("預選第一個類型；沒有想法時就地提示，寫好後先 POST /jobs 再 submit，進入任務頁", async () => {
    const created = makeJob({ id: "job-new", title: "清晨的茶園，推廣自家綠茶", status: "draft" });
    const api = mockApi({
      "GET /auth/me": makeUser(),
      "GET /templates": [marketing, quick],
      "POST /jobs/estimate": estimate,
      "POST /jobs": created,
      "POST /jobs/job-new/submit": { ...created, status: "scripting" },
      "GET /jobs/job-new": { ...created, status: "scripting" },
      "GET /jobs/job-new/calls": [],
    });
    renderApp("/jobs/new");

    expect(await screen.findByRole("heading", { name: "開一支新片" })).toBeInTheDocument();
    await waitFor(() => pressed("行銷短影音"));
    pressed("9:16");
    pressed("TTS 配音");
    expect(screen.getByRole("button", { name: /選擇商品圖/ })).toBeInTheDocument();

    // 沒有想法：就地提示，不送出
    await userEvent.click(screen.getByRole("button", { name: /寫分鏡/ }));
    expect(await screen.findByText("先寫下想法")).toBeInTheDocument();
    expect(screen.getByLabelText("主題")).toHaveAttribute("aria-invalid", "true");
    expect(api.find("POST", "/jobs")).toHaveLength(0);

    await userEvent.type(screen.getByLabelText("主題"), "清晨的茶園，推廣自家綠茶");
    expect(screen.queryByText("先寫下想法")).not.toBeInTheDocument();
    // 片名留空時用想法的開頭
    expect(screen.getByPlaceholderText("清晨的茶園，推廣自家綠茶")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "先出樣片" }));
    await userEvent.click(screen.getByRole("button", { name: /寫分鏡/ }));

    expect(
      await screen.findByRole("heading", { name: "清晨的茶園，推廣自家綠茶" }),
    ).toBeInTheDocument();
    expect(api.find("POST", "/jobs")[0]?.body).toEqual({
      template_id: "tpl-marketing",
      title: "清晨的茶園，推廣自家綠茶",
      inputs: { topic: "清晨的茶園，推廣自家綠茶", extra: "" },
      ratio: "9:16",
      target_duration_s: null,
      audio_mode: "tts",
      draft_mode: true,
      continuous_shots: false,
      logo_asset_id: null,
      bgm_asset_id: null,
      product_asset_ids: [],
    });
    const order = api.calls.map((c) => `${c.method} ${c.path}`);
    expect(order.indexOf("POST /jobs")).toBeLessThan(order.indexOf("POST /jobs/job-new/submit"));
  });

  it("預估費用：顯示明細與預算比例；換類型、畫幅、長度後重算", async () => {
    const api = mockApi({
      "GET /auth/me": makeUser(),
      "GET /templates": [marketing, quick],
      "POST /jobs/estimate": estimate,
    });
    renderApp("/jobs/new");

    expect(await screen.findByText("≈ ¥42.50")).toBeInTheDocument();
    expect(screen.getByText("腳本")).toBeInTheDocument();
    expect(screen.getByText("佔單任務預算 ¥150.00 的 28%")).toBeInTheDocument();
    expect(api.find("POST", "/jobs/estimate")[0]?.body).toEqual({
      template_id: "tpl-marketing",
      target_duration_s: null,
      ratio: "9:16",
      audio_mode: "tts",
      draft_mode: false,
    });

    // 換類型：畫幅與長度範圍跟著模板
    await userEvent.click(screen.getByRole("button", { name: "圖文轉短片" }));
    pressed("1:1");
    expect(screen.getByText("0:05")).toBeInTheDocument();
    expect(screen.getByText("0:10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /選擇首幀/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /選擇商品圖/ })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(api.find("POST", "/jobs/estimate").at(-1)?.body).toMatchObject({
        template_id: "tpl-quick",
        ratio: "1:1",
        audio_mode: "none",
      }),
    );

    // 指定長度與畫幅
    fireEvent.change(screen.getByRole("slider", { name: "目標時長" }), { target: { value: "9" } });
    await userEvent.click(screen.getByRole("button", { name: "16:9" }));
    expect(screen.getByTestId("monitor-frame")).toHaveStyle({ "--vf-rw": "16" });
    await waitFor(() =>
      expect(api.find("POST", "/jobs/estimate").at(-1)?.body).toMatchObject({
        target_duration_s: 9,
        ratio: "16:9",
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "改回自動" }));
    expect(screen.getByText("自動")).toBeInTheDocument();
  });

  it("預估失敗時顯示暫時無法估算，仍可送出", async () => {
    const created = makeJob({ id: "job-e", title: "茶", status: "draft" });
    const api = mockApi({
      "GET /auth/me": makeUser(),
      "GET /templates": [marketing],
      "POST /jobs/estimate": json(503, { detail: "暫時無法連線" }),
      "POST /jobs": created,
      "POST /jobs/job-e/submit": { ...created, status: "scripting" },
      "GET /jobs/job-e": { ...created, status: "scripting" },
      "GET /jobs/job-e/calls": [],
    });
    renderApp("/jobs/new");
    expect(await screen.findByText(/暫時無法估算/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("主題"), "茶");
    await userEvent.click(screen.getByRole("button", { name: /寫分鏡/ }));
    await waitFor(() => expect(api.find("POST", "/jobs/job-e/submit")).toHaveLength(1));
  });

  it("超出單任務預算時提示", async () => {
    mockApi({
      "GET /auth/me": makeUser(),
      "GET /templates": [marketing],
      "POST /jobs/estimate": { ...estimate, total_cny: 180, within_budget: false },
    });
    renderApp("/jobs/new");
    expect(await screen.findByText("超過單任務預算，請縮短長度或關閉樣片。")).toBeInTheDocument();
    expect(screen.getByText("佔單任務預算 ¥150.00 的 120%")).toBeInTheDocument();
  });

  it("從片場帶來的類型與想法會預先填好", async () => {
    mockApi({
      "GET /auth/me": makeUser(),
      "GET /templates": [marketing, quick],
    });
    renderApp("/jobs/new?template=tpl-quick&topic=%E8%8C%B6%E6%9D%AF%E7%89%B9%E5%AF%AB");
    await waitFor(() => pressed("圖文轉短片"));
    expect(screen.getByLabelText("主題")).toHaveValue("茶杯特寫");
  });

  it("提交失敗時顯示錯誤、TAKE 加一，重試不會重複建立任務", async () => {
    const created = makeJob({ id: "job-x" });
    let submitAttempts = 0;
    const api = mockApi({
      "GET /auth/me": makeUser(),
      "GET /templates": [marketing],
      "POST /jobs": created,
      "POST /jobs/job-x/submit": () => {
        submitAttempts += 1;
        return submitAttempts === 1
          ? json(409, { detail: "今日預算已用完" })
          : { ...created, status: "scripting" };
      },
      "GET /jobs/job-x": created,
      "GET /jobs/job-x/calls": [],
    });
    renderApp("/jobs/new");
    await waitFor(() => pressed("行銷短影音"));
    await userEvent.type(screen.getByLabelText("主題"), "topic");
    expect(screen.getByText(/TAKE 1/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /寫分鏡/ }));
    expect(await screen.findByText("今日預算已用完")).toBeInTheDocument();
    expect(screen.getByText(/TAKE 2/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /寫分鏡/ }));
    await waitFor(() => expect(submitAttempts).toBe(2));
    expect(api.find("POST", "/jobs")).toHaveLength(1);
  });
});

describe("開新片：聲音方式（v1.1）", () => {
  it("TTS 不可用時隱藏 TTS、模板預設 TTS 改選原生聲音，並送出聲音風格、配樂與聲音一致", async () => {
    const created = makeJob({ id: "job-n", title: "茶園", status: "draft" });
    const api = mockApi({
      "GET /meta": makeMeta({
        region: "byteplus",
        tts_available: false,
        audio_modes: ["native", "none"],
      }),
      "GET /auth/me": makeUser(),
      "GET /templates": [marketing],
      "POST /jobs": created,
      "POST /jobs/job-n/submit": { ...created, status: "scripting" },
      "GET /jobs/job-n": { ...created, status: "scripting" },
      "GET /jobs/job-n/calls": [],
    });
    renderApp("/jobs/new");
    await waitFor(() => pressed("行銷短影音"));
    await waitFor(() => pressed("模型原生聲音（推薦）"));
    expect(screen.getByTestId("tts-unavailable")).toHaveTextContent("目前區域不提供 TTS 配音");
    expect(screen.getByRole("button", { name: "無聲" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "TTS 配音" })).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("片名", { exact: false }), "茶園");
    await userEvent.type(screen.getByLabelText("主題"), "清晨的茶園");
    await userEvent.type(screen.getByLabelText("聲音風格"), "溫暖的年輕女聲，國語");
    await userEvent.type(screen.getByLabelText("配樂"), "輕快的鋼琴");
    await userEvent.click(screen.getByRole("switch", { name: /聲音一致/ }));
    await userEvent.click(screen.getByRole("button", { name: /寫分鏡/ }));

    expect(await screen.findByRole("heading", { name: "茶園" })).toBeInTheDocument();
    expect(api.find("POST", "/jobs")[0]?.body).toMatchObject({
      title: "茶園",
      audio_mode: "native",
      voice_style: "溫暖的年輕女聲，國語",
      music: "輕快的鋼琴",
      consistent_voice: true,
    });
  });

  it("TTS 可用時保留模板預設的 TTS，不顯示原生聲音欄位；切到原生聲音後出現", async () => {
    mockApi({
      "GET /auth/me": makeUser(),
      "GET /templates": [marketing],
    });
    renderApp("/jobs/new");
    await waitFor(() => pressed("行銷短影音"));
    pressed("TTS 配音");
    expect(screen.queryByTestId("tts-unavailable")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("聲音風格")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /聲音一致/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "模型原生聲音（推薦）" }));
    expect(await screen.findByLabelText("聲音風格")).toBeInTheDocument();
    expect(screen.getByLabelText("配樂")).toHaveAttribute("maxlength", "100");
    expect(screen.getByRole("switch", { name: /聲音一致/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("選到長鏡頭模板時顯示 Seedance 2.5 標籤", async () => {
    mockApi({
      "GET /auth/me": makeUser(),
      "GET /templates": [marketing, { ...quick, video_model: "video_long" }],
    });
    renderApp("/jobs/new");
    await waitFor(() => pressed("行銷短影音"));
    expect(screen.queryByText("Seedance 2.5 長鏡頭")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "圖文轉短片" }));
    expect(screen.getByText("Seedance 2.5 長鏡頭")).toBeInTheDocument();
  });
});

describe("聲音方式的可選項", () => {
  it("依 /meta 過濾，原生聲音排第一；/meta 未載入時不隱藏", () => {
    expect(availableAudioModes(undefined)).toEqual(["native", "tts", "none"]);
    expect(availableAudioModes(makeMeta())).toEqual(["native", "tts", "none"]);
    expect(
      availableAudioModes(
        makeMeta({ tts_available: false, audio_modes: ["native", "tts", "none"] }),
      ),
    ).toEqual(["native", "none"]);
    expect(defaultAudioMode(marketing, makeMeta({ tts_available: false }))).toBe("native");
    expect(defaultAudioMode(marketing, makeMeta())).toBe("tts");
    expect(defaultAudioMode(quick, makeMeta({ tts_available: false }))).toBe("none");
  });
});

describe("buildJobCreate", () => {
  it("native 時送出聲音欄位（空字串不送），其他模式不送", () => {
    const base = {
      title: "t",
      topic: "topic",
      ratio: "9:16" as const,
      draft_mode: false,
      continuous_shots: false,
      voice_style: "  ",
      music: " none ",
      consistent_voice: false,
    };
    const native = buildJobCreate(marketing, { ...base, audio_mode: "native" });
    expect(native.voice_style).toBeUndefined();
    expect(native.music).toBe("none");
    expect(native.consistent_voice).toBe(false);

    const tts = buildJobCreate(marketing, { ...base, audio_mode: "tts" });
    expect(tts).not.toHaveProperty("voice_style");
    expect(tts).not.toHaveProperty("music");
    expect(tts).not.toHaveProperty("consistent_voice");
  });

  it("quick 類型送首幀 image_asset_id，不送商品圖", () => {
    const body = buildJobCreate(quick, {
      title: " 單圖 ",
      topic: " 茶杯特寫 ",
      image_asset_ids: ["img-1"],
      product_asset_ids: ["p-1"],
      logo_asset_ids: ["logo-1"],
      ratio: "1:1",
      target_duration_s: 5,
      audio_mode: "none",
      draft_mode: false,
      continuous_shots: false,
    });
    expect(body.image_asset_id).toBe("img-1");
    expect(body.product_asset_ids).toBeUndefined();
    expect(body.logo_asset_id).toBe("logo-1");
    expect(body.title).toBe("單圖");
    expect(body.inputs.topic).toBe("茶杯特寫");
  });
});
