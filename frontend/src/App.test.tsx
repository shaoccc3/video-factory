import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import i18n from "./i18n";

describe("App", () => {
  it("預設繁體中文並顯示空的任務列表", async () => {
    await i18n.changeLanguage("zh-TW");
    render(<App initialPath="/" />);
    expect(await screen.findByRole("heading", { name: "任務列表" })).toBeInTheDocument();
    expect(screen.getAllByText("目前還沒有任務").length).toBeGreaterThan(0);
  });

  it("登入頁校驗必填欄位", async () => {
    await i18n.changeLanguage("zh-TW");
    render(<App initialPath="/login" />);
    await userEvent.click(await screen.findByRole("button", { name: "登入" }));
    expect(await screen.findByText("請輸入電子郵件")).toBeInTheDocument();
    expect(await screen.findByText("請輸入密碼")).toBeInTheDocument();
  });

  it("可切換為簡體中文", async () => {
    await i18n.changeLanguage("zh-CN");
    render(<App initialPath="/jobs" />);
    expect(await screen.findByRole("heading", { name: "任务列表" })).toBeInTheDocument();
    await i18n.changeLanguage("zh-TW");
  });
});
