import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeUser } from "../test/fixtures";
import { mockApi, renderApp } from "../test/utils";
import { fillDays, niceMax } from "./UsagePage";

const summary = {
  total_cny: 123.45,
  today_user_cny: 250,
  daily_budget_cny: 300,
  by_user: [
    { user_id: "u-2", display_name: "小編", amount_cny: 23.45 },
    { user_id: "u-1", display_name: "小創", amount_cny: 100 },
  ],
  by_day: [
    { date: "2026-09-22", amount_cny: 20 },
    { date: "2026-09-23", amount_cny: 30 },
  ],
  by_model: [{ model_id: "seedance-pro", calls: 12, amount_cny: 90 }],
};

describe("用量", () => {
  // 圖表以「今天」為終點補齊日期：固定今天，測試才不會隨執行日期改變
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 23, 12));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("三個大數字、預算剩餘與接近上限提示、按模型與用戶的比例表", async () => {
    mockApi({ "GET /auth/me": makeUser(), "GET /usage/summary": summary });
    renderApp("/usage");
    expect(await screen.findByText("seedance-pro")).toBeInTheDocument();
    const tiles = screen.getByRole("region", { name: "花費摘要" });
    expect(within(tiles).getAllByText("¥250.00").length).toBeGreaterThan(0);
    expect(within(tiles).getByText("¥123.45")).toBeInTheDocument();
    expect(within(tiles).getByText("¥50.00")).toBeInTheDocument();
    expect(within(tiles).getByText("¥250.00 / ¥300.00 · 83%")).toBeInTheDocument();
    expect(screen.getByText("今日花費已接近每日預算上限")).toBeInTheDocument();
    // 按花費由多到少，附佔比
    const users = within(screen.getByRole("region", { name: "按用戶" }))
      .getAllByRole("row")
      .slice(1)
      .map((r) => r.textContent);
    expect(users).toEqual(["小創¥100.0081%", "小編¥23.4519%"]);
  });

  it("每日花費：單一系列長條，最高一天直接標值；聚焦柱子顯示提示；可切換表格", async () => {
    mockApi({ "GET /auth/me": makeUser(), "GET /usage/summary": summary });
    renderApp("/usage");
    const chart = await screen.findByRole("img", { name: "每日花費" });
    // 沒有花費的日子補 0（不畫柱），只有兩天有柱
    expect(chart.querySelectorAll("[data-bar]")).toHaveLength(2);
    expect(chart.querySelectorAll(".vf-chart-hit")).toHaveLength(30);
    expect(within(chart).getByText("¥30.00")).toBeInTheDocument();

    const hit = chart.querySelector('[aria-label="2026-09-22 ¥20.00"]') as SVGElement;
    fireEvent.focus(hit);
    expect(screen.getByTestId("chart-tip")).toHaveTextContent("¥20.002026-09-22");
    fireEvent.blur(hit);

    await userEvent.click(screen.getByRole("button", { name: "以表格檢視" }));
    const table = screen.getByRole("table", { name: "每日花費" });
    expect(within(table).getByText("2026-09-23")).toBeInTheDocument();
    expect(within(table).getByText("¥30.00")).toBeInTheDocument();
  });

  it("切換統計區間會重新查詢", async () => {
    const api = mockApi({ "GET /auth/me": makeUser(), "GET /usage/summary": summary });
    renderApp("/usage");
    await screen.findByText("seedance-pro");
    await userEvent.click(screen.getByRole("button", { name: "近 7 天" }));
    await waitFor(() => expect(api.find("GET", "/usage/summary").at(-1)?.path).toContain("days=7"));
  });
});

describe("補齊日期", () => {
  it("以今天或最後一筆為終點，往前補滿天數", () => {
    const filled = fillDays([{ date: "2026-09-22", amount_cny: 20 }], 3, new Date(2026, 8, 23));
    expect(filled).toEqual([
      { date: "2026-09-21", amount_cny: 0 },
      { date: "2026-09-22", amount_cny: 20 },
      { date: "2026-09-23", amount_cny: 0 },
    ]);
  });
});

describe("刻度取整", () => {
  it("取 1、2、2.5、5 × 10^n", () => {
    expect([0, 0.8, 1.7, 2.3, 4, 30, 72, 180].map(niceMax)).toEqual([
      1, 1, 2, 2.5, 5, 50, 100, 200,
    ]);
  });
});
