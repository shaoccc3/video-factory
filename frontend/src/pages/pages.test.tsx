import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeTemplate, makeUser } from "../test/fixtures";
import { mockApi, renderApp } from "../test/utils";
import { formatDetail } from "./admin/AuditTab";

describe("管理", () => {
  it("修改預算送出 PATCH /config/budget", async () => {
    const config = {
      region: "byteplus",
      provider_mode: "mock",
      currency: "CNY",
      models: {
        script_llm: { id: "seed-lite", price_per_mtok_input: 0.25, price_per_mtok_output: 2 },
        video_hd: { id: "seedance-hd", price_per_mtok_by_resolution: { "720p": 7, "1080p": 7.7 } },
        video: {
          id: "seedance-pro",
          price_per_mtok: 7,
          price_per_mtok_by_resolution: { "1080p": 7.7 },
          rpm: 60,
          concurrency: 5,
        },
      },
      budget: { per_job_cny: 50, per_user_daily_cny: 300 },
    };
    const api = mockApi({
      "GET /auth/me": makeUser(),
      "GET /config/models": config,
      "PATCH /config/budget": { per_job_cny: 80, per_user_daily_cny: 300 },
    });
    renderApp("/admin?tab=budget");
    expect(await screen.findByText("seedance-pro")).toBeInTheDocument();
    expect(screen.getByText("入 0.25／出 2")).toBeInTheDocument();
    expect(screen.getByText("7（1080p 7.7）")).toBeInTheDocument();
    expect(screen.getByText("720p 7、1080p 7.7")).toBeInTheDocument();
    const perJob = screen.getByLabelText("單任務預算");
    await userEvent.clear(perJob);
    await userEvent.type(perJob, "80");
    await userEvent.click(screen.getByRole("button", { name: "儲存" }));
    await waitFor(() => expect(api.find("PATCH", "/config/budget")).toHaveLength(1));
    expect(api.find("PATCH", "/config/budget")[0]?.body).toEqual({
      per_job_cny: 80,
      per_user_daily_cny: 300,
    });
  });

  it("模板表單可選影片模型，編輯後 PATCH 帶 video_model", async () => {
    const tpl = makeTemplate();
    const api = mockApi({
      "GET /auth/me": makeUser(),
      "GET /templates": [tpl],
      "PATCH /templates/tpl-marketing": { ...tpl, video_model: "video_long", version: 2 },
    });
    renderApp("/admin?tab=templates");
    expect(await screen.findByText("Seedance 2.0")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /編輯/ }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByLabelText("影片模型"));
    await userEvent.click(await screen.findByTitle("Seedance 2.5（最長 30 秒）"));
    await userEvent.click(within(dialog).getByRole("button", { name: /儲存/ }));
    await waitFor(() => expect(api.find("PATCH", "/templates/tpl-marketing")).toHaveLength(1));
    expect(api.find("PATCH", "/templates/tpl-marketing")[0]?.body).toMatchObject({
      video_model: "video_long",
    });
  });

  it("用戶管理列出用戶與角色", async () => {
    mockApi({
      "GET /auth/me": makeUser(),
      "GET /users": [makeUser({ id: "u-2", display_name: "小審", roles: ["reviewer"] })],
    });
    renderApp("/admin?tab=users");
    expect(await screen.findByText("小審")).toBeInTheDocument();
    expect(screen.getByText("系統預設")).toBeInTheDocument();
  });

  it("審計詳情格式化", () => {
    expect(formatDetail({ a: 1 })).toBe('{"a":1}');
    expect(formatDetail(null)).toBe("—");
    expect(formatDetail("x")).toBe("x");
  });
});
