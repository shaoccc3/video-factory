import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Asset, Batch } from "../api/types";
import { makeJobSummary, makeTemplate, makeUser } from "../test/fixtures";
import { mockApi, renderApp } from "../test/utils";
import { formatDetail } from "./admin/AuditTab";

function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "a-1",
    kind: "product",
    mime: "image/png",
    size: 2048,
    width: 800,
    height: 800,
    duration_s: null,
    tags: ["綠茶"],
    display_name: "茶罐.png",
    source: "upload",
    created_at: "2026-09-20T00:00:00Z",
    content_url: "/api/v1/assets/a-1/content",
    thumbnail_url: "/api/v1/assets/a-1/thumbnail",
    ...overrides,
  };
}

describe("素材庫", () => {
  it("列出素材並以 multipart 上傳（kind + tags）", async () => {
    const api = mockApi({
      "GET /auth/me": makeUser(),
      "GET /assets": { items: [makeAsset()], total: 1 },
      "POST /assets": makeAsset({ id: "a-2", kind: "logo" }),
    });
    renderApp("/assets");
    expect(await screen.findByText("茶罐.png")).toBeInTheDocument();
    expect(screen.getByAltText("茶罐.png")).toHaveAttribute("src", "/api/v1/assets/a-1/thumbnail");

    await userEvent.click(screen.getByRole("button", { name: /上傳素材/ }));
    const dialog = await screen.findByRole("dialog");
    const input = dialog.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(["png"], "logo.png", { type: "image/png" });
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });
    const tagInput = within(dialog).getAllByRole("combobox")[1] as HTMLElement;
    await userEvent.type(tagInput, "品牌{enter}");
    await userEvent.click(await within(dialog).findByRole("button", { name: /^上傳素材$/ }));

    await waitFor(() => expect(api.find("POST", "/assets")).toHaveLength(1));
    const form = api.find("POST", "/assets")[0]?.body as FormData;
    expect(form.get("kind")).toBe("logo");
    expect(form.get("tags")).toBe("品牌");
    expect((form.get("file") as File).name).toBe("logo.png");
  });
});

describe("用量看板", () => {
  it("顯示總額、今日預算進度與按模型統計", async () => {
    mockApi({
      "GET /auth/me": makeUser(),
      "GET /usage/summary": {
        total_cny: 123.45,
        today_user_cny: 250,
        daily_budget_cny: 300,
        by_user: [{ user_id: "u-1", display_name: "小創", amount_cny: 100 }],
        by_day: [
          { date: "2026-09-22", amount_cny: 20 },
          { date: "2026-09-23", amount_cny: 30 },
        ],
        by_model: [{ model_id: "seedance-pro", calls: 12, amount_cny: 90 }],
      },
    });
    renderApp("/usage");
    expect(await screen.findByText("seedance-pro")).toBeInTheDocument();
    expect(screen.getByText("小創")).toBeInTheDocument();
    expect(screen.getByText("今日花費已接近每日預算上限")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "每日花費" }).querySelectorAll("rect")).toHaveLength(2);
  });
});

describe("成片庫", () => {
  it("只有已通過的成片可下載", async () => {
    mockApi({
      "GET /auth/me": makeUser(),
      "GET /jobs": {
        items: [
          makeJobSummary({ status: "approved", final_asset_id: "f-1", cover_asset_id: "c-1" }),
          makeJobSummary({ id: "job-2", title: "無成片", status: "approved" }),
        ],
        total: 2,
      },
    });
    renderApp("/library");
    expect(await screen.findByText("綠茶推廣")).toBeInTheDocument();
    expect(screen.queryByText("無成片")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /下載/ })).toHaveAttribute(
      "href",
      "/api/v1/assets/f-1/download",
    );
  });
});

describe("批量", () => {
  it("上傳 CSV 建立批量並進入詳情", async () => {
    const batch: Batch = {
      id: "b-1",
      template_id: "tpl-marketing",
      template_name: "行銷短影音",
      total: 2,
      max_parallel: 2,
      status: "running",
      created_at: "2026-09-23T00:00:00Z",
      counts: { scripting: 2 },
    };
    const api = mockApi({
      "GET /auth/me": makeUser(),
      "GET /batches": [],
      "GET /templates": [makeTemplate()],
      "POST /batches/csv": batch,
      "GET /batches/b-1": { ...batch, jobs: [makeJobSummary({ batch_id: "b-1" })] },
    });
    renderApp("/batches");
    await userEvent.click(await screen.findByRole("button", { name: /建立批量/ }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getAllByRole("combobox")[0] as HTMLElement);
    await userEvent.click(await screen.findByTitle("行銷短影音"));
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["title,topic,extra\n"], "jobs.csv", { type: "text/csv" })] },
    });
    await userEvent.click(within(dialog).getByRole("button", { name: /^建立批量$/ }));

    expect(await screen.findByText("批量：行銷短影音")).toBeInTheDocument();
    const form = api.find("POST", "/batches/csv")[0]?.body as FormData;
    expect(form.get("template_id")).toBe("tpl-marketing");
    expect(form.get("max_parallel")).toBe("2");
    expect(form.get("draft_mode")).toBe("false");
    expect(screen.getByRole("link", { name: "綠茶推廣" })).toBeInTheDocument();
  });
});

describe("管理", () => {
  it("修改預算送出 PATCH /config/budget", async () => {
    const config = {
      region: "byteplus",
      provider_mode: "mock",
      currency: "CNY",
      models: { video: { id: "seedance-pro", rpm: 60, concurrency: 5 } },
      budget: { per_job_cny: 50, per_user_daily_cny: 300 },
    };
    const api = mockApi({
      "GET /auth/me": makeUser(),
      "GET /config/models": config,
      "PATCH /config/budget": { per_job_cny: 80, per_user_daily_cny: 300 },
    });
    renderApp("/admin?tab=budget");
    expect(await screen.findByText("seedance-pro")).toBeInTheDocument();
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
