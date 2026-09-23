import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeJob, makeTemplate, makeUser } from "../test/fixtures";
import { json, mockApi, renderApp } from "../test/utils";
import { buildJobCreate } from "./JobWizardPage";

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

describe("buildJobCreate", () => {
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
