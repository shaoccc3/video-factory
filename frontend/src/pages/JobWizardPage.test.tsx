import { screen, waitFor } from "@testing-library/react";
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

describe("新建任務精靈", () => {
  it("選模板 → 填主題 → 設定 → 提交：先 POST /jobs 再 submit，最後進入詳情頁", async () => {
    const created = makeJob({ id: "job-new", title: "茶園", status: "draft" });
    const api = mockApi({
      "GET /auth/me": makeUser(),
      "GET /templates": [marketing, quick],
      "POST /jobs": created,
      "POST /jobs/job-new/submit": { ...created, status: "scripting" },
      "GET /jobs/job-new": { ...created, status: "scripting" },
      "GET /jobs/job-new/calls": [],
    });
    renderApp("/jobs/new");

    const next = () => userEvent.click(screen.getByRole("button", { name: "下一步" }));

    // 第一步：沒選模板時不能下一步
    expect(await screen.findByRole("radio", { name: /行銷短影音/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: /行銷短影音/ }));
    await next();

    // 第二步：必填校驗
    await next();
    expect(await screen.findByText("請輸入任務標題")).toBeInTheDocument();
    expect(screen.getByText("請輸入主題")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /選擇商品圖/ })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("任務標題"), "茶園");
    await userEvent.type(screen.getByLabelText("主題"), "清晨的茶園，推廣自家綠茶");
    await next();

    // 第三步：預設值來自模板
    expect(await screen.findByLabelText("目標時長")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "樣片模式" }));
    await next();

    // 第四步：確認並提交
    expect(await screen.findByText("清晨的茶園，推廣自家綠茶")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "建立並提交" }));

    expect(await screen.findByRole("heading", { name: "茶園" })).toBeInTheDocument();
    const createCall = api.find("POST", "/jobs")[0];
    expect(createCall?.body).toEqual({
      template_id: "tpl-marketing",
      title: "茶園",
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
    expect(api.find("POST", "/jobs/job-new/submit")).toHaveLength(1);
    const order = api.calls.map((c) => `${c.method} ${c.path}`);
    expect(order.indexOf("POST /jobs")).toBeLessThan(order.indexOf("POST /jobs/job-new/submit"));
  });

  it("提交失敗時顯示錯誤，重試不會重複建立任務", async () => {
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
    await userEvent.click(await screen.findByRole("radio", { name: /行銷短影音/ }));
    await userEvent.click(screen.getByRole("button", { name: "下一步" }));
    await userEvent.type(await screen.findByLabelText("任務標題"), "t");
    await userEvent.type(screen.getByLabelText("主題"), "topic");
    await userEvent.click(screen.getByRole("button", { name: "下一步" }));
    await screen.findByLabelText("目標時長");
    await userEvent.click(screen.getByRole("button", { name: "下一步" }));
    await userEvent.click(await screen.findByRole("button", { name: "建立並提交" }));
    expect(await screen.findByText("今日預算已用完")).toBeInTheDocument();

    // antd 的 loading 圖示在 jsdom 中不會淡出，因此用正則比對按鈕名稱
    await userEvent.click(screen.getByRole("button", { name: /建立並提交/ }));
    await waitFor(() => expect(submitAttempts).toBe(2));
    expect(api.find("POST", "/jobs")).toHaveLength(1);
  });
});

describe("新建任務精靈：聲音方式（v1.1）", () => {
  async function goToSettings(title: string) {
    await userEvent.click(await screen.findByRole("radio", { name: /行銷短影音/ }));
    await userEvent.click(screen.getByRole("button", { name: "下一步" }));
    await userEvent.type(await screen.findByLabelText("任務標題"), title);
    await userEvent.type(screen.getByLabelText("主題"), "清晨的茶園");
    await userEvent.click(screen.getByRole("button", { name: "下一步" }));
    await screen.findByLabelText("目標時長");
  }

  it("TTS 不可用時隱藏 TTS 選項、模板預設 TTS 改選原生聲音，並送出聲音風格、配樂與聲音一致", async () => {
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
    await goToSettings("茶園");

    // 模板預設是 tts，但目前區域不提供：改選 native 並提示
    expect(screen.getByTestId("tts-unavailable")).toHaveTextContent("目前區域不提供 TTS 配音");
    await userEvent.click(screen.getByLabelText("聲音方式"));
    expect((await screen.findAllByTitle("模型原生聲音（推薦）")).length).toBeGreaterThan(0);
    expect(screen.getByTitle("無聲")).toBeInTheDocument();
    expect(screen.queryByTitle("TTS 配音")).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    // 原生聲音的欄位
    await userEvent.type(screen.getByLabelText("聲音風格"), "溫暖的年輕女聲，國語");
    await userEvent.type(screen.getByLabelText("配樂"), "輕快的鋼琴");
    await userEvent.click(screen.getByRole("switch", { name: /聲音一致/ }));
    await userEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(await screen.findByText("溫暖的年輕女聲，國語")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "建立並提交" }));
    expect(await screen.findByRole("heading", { name: "茶園" })).toBeInTheDocument();
    expect(api.find("POST", "/jobs")[0]?.body).toMatchObject({
      audio_mode: "native",
      voice_style: "溫暖的年輕女聲，國語",
      music: "輕快的鋼琴",
      consistent_voice: true,
    });
  });

  it("TTS 可用時保留模板預設的 TTS，不顯示原生聲音欄位", async () => {
    mockApi({
      "GET /auth/me": makeUser(),
      "GET /templates": [marketing],
    });
    renderApp("/jobs/new");
    await goToSettings("t");
    expect(screen.queryByTestId("tts-unavailable")).not.toBeInTheDocument();
    expect(screen.getByTitle("TTS 配音")).toBeInTheDocument();
    expect(screen.queryByLabelText("聲音風格")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /聲音一致/ })).not.toBeInTheDocument();

    // 切到原生聲音後出現三個欄位
    await userEvent.click(screen.getByLabelText("聲音方式"));
    await userEvent.click(await screen.findByTitle("模型原生聲音（推薦）"));
    expect(await screen.findByLabelText("聲音風格")).toBeInTheDocument();
    expect(screen.getByLabelText("配樂")).toHaveAttribute("maxlength", "100");
    expect(screen.getByRole("switch", { name: /聲音一致/ })).not.toBeChecked();
  });

  it("選到長鏡頭模板時顯示 Seedance 2.5 標籤", async () => {
    mockApi({
      "GET /auth/me": makeUser(),
      "GET /templates": [marketing, { ...quick, video_model: "video_long" }],
    });
    renderApp("/jobs/new");
    const longCard = await screen.findByRole("radio", { name: /圖文轉短片/ });
    expect(longCard).toHaveTextContent("Seedance 2.5 長鏡頭");
    expect(screen.getByRole("radio", { name: /行銷短影音/ })).not.toHaveTextContent("Seedance");
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
