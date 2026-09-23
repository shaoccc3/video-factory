import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeJob, makeJobSummary, makeUser } from "../test/fixtures";
import { mockApi, renderApp } from "../test/utils";

const films = {
  items: [
    makeJobSummary({
      status: "approved",
      final_asset_id: "f-1",
      cover_asset_id: "c-1",
      runtime_s: 22,
    }),
    makeJobSummary({ id: "job-2", title: "無成片", status: "approved" }),
    makeJobSummary({
      id: "job-3",
      title: "海岸日落",
      status: "approved",
      ratio: "16:9",
      final_asset_id: "f-3",
    }),
  ],
  total: 3,
};

describe("放映室", () => {
  it("只列出有成片的片，已通過的成片可下載", async () => {
    mockApi({ "GET /auth/me": makeUser(), "GET /jobs": films });
    renderApp("/library");
    expect(await screen.findByRole("heading", { name: "綠茶推廣" })).toBeInTheDocument();
    expect(screen.queryByText("無成片")).not.toBeInTheDocument();
    const card = screen.getByRole("article", { name: "綠茶推廣" });
    expect(within(card).getByText("行銷短影音 · 9:16 · 0:22 · 2026.09.23")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "下載" })).toHaveAttribute(
      "href",
      "/api/v1/assets/f-1/download",
    );
  });

  it("點片開放映燈箱並寫進網址；關閉後移除", async () => {
    mockApi({ "GET /auth/me": makeUser(), "GET /jobs": films });
    renderApp("/library");
    await userEvent.click(await screen.findByRole("button", { name: "放映《海岸日落》" }));
    const video = await screen.findByTestId("lightbox-video");
    expect(video).toHaveAttribute("src", "/api/v1/assets/f-3/content");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "海岸日落" })).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "下載" })).toHaveAttribute(
      "href",
      "/api/v1/assets/f-3/download",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: /close|關閉/i }));
    // antd 的關閉動畫結束後才移除內容
    await waitFor(() => expect(screen.queryByTestId("lightbox-video")).not.toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it("?play= 直接開片；不在這一頁的片單獨讀取，待審核的片不能下載", async () => {
    const api = mockApi({
      "GET /auth/me": makeUser(),
      "GET /jobs": films,
      "GET /jobs/job-9": makeJob({
        id: "job-9",
        title: "山谷清晨",
        status: "in_review",
        final_asset_id: "f-9",
      }),
    });
    renderApp("/library?play=job-9");
    const video = await screen.findByTestId("lightbox-video");
    expect(video).toHaveAttribute("src", "/api/v1/assets/f-9/content");
    expect(api.find("GET", "/jobs/job-9")).toHaveLength(1);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("link", { name: "下載" })).not.toBeInTheDocument();
    expect(within(dialog).getByText("審核通過後才可下載")).toBeInTheDocument();
  });

  it("類型頁籤與待審核頁籤會重新查詢", async () => {
    const api = mockApi({ "GET /auth/me": makeUser(), "GET /jobs": films });
    renderApp("/library");
    await screen.findByRole("heading", { name: "綠茶推廣" });
    await userEvent.click(screen.getByRole("button", { name: "培訓講解片" }));
    await waitFor(() =>
      expect(api.find("GET", "/jobs").at(-1)?.path).toContain("video_type=training"),
    );
    await userEvent.click(screen.getByRole("button", { name: "待審核" }));
    await waitFor(() =>
      expect(api.find("GET", "/jobs").at(-1)?.path).toContain("status=in_review"),
    );
  });
});
