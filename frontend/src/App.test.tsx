import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import i18n from "./i18n";
import { safeRedirect } from "./pages/LoginPage";
import { makeJobSummary, makeUser } from "./test/fixtures";
import { json, mockApi, renderApp } from "./test/utils";

const emptyJobs = { items: [], total: 0 };

describe("App 與認證", () => {
  it("已登入時預設繁體中文並顯示片場", async () => {
    await i18n.changeLanguage("zh-TW");
    mockApi({ "GET /auth/me": makeUser(), "GET /jobs": emptyJobs, "GET /templates": [] });
    renderApp("/");
    expect(await screen.findByRole("heading", { name: "片場" })).toBeInTheDocument();
    expect(await screen.findByText("片場目前沒有進行中的片。")).toBeInTheDocument();
  });

  it("未登入（401）時導向登入頁並記住原路徑", async () => {
    const api = mockApi({ "GET /auth/me": json(401, { detail: "未登入" }) });
    renderApp("/jobs?status=draft");
    expect(await screen.findByRole("button", { name: "登入" })).toBeInTheDocument();
    expect(api.find("GET", "/jobs")).toHaveLength(0);
  });

  it("登入成功後回到原頁面", async () => {
    let loggedIn = false;
    const api = mockApi({
      "GET /auth/me": () => (loggedIn ? makeUser() : json(401, { detail: "未登入" })),
      "POST /auth/login": () => {
        loggedIn = true;
        return makeUser();
      },
      "GET /usage/summary": {
        total_cny: 0,
        today_user_cny: 0,
        daily_budget_cny: 300,
        by_user: [],
        by_day: [],
        by_model: [],
      },
    });
    renderApp("/usage");
    await userEvent.type(await screen.findByLabelText("電子郵件"), "admin@example.com");
    await userEvent.type(screen.getByLabelText("密碼"), "admin-pass-123");
    await userEvent.click(screen.getByRole("button", { name: "登入" }));
    expect(await screen.findByRole("heading", { name: "用量看板" })).toBeInTheDocument();
    expect(api.find("POST", "/auth/login")[0]?.body).toEqual({
      email: "admin@example.com",
      password: "admin-pass-123",
    });
  });

  it("登入失敗顯示錯誤", async () => {
    mockApi({
      "GET /auth/me": json(401, { detail: "未登入" }),
      "POST /auth/login": json(401, { detail: "invalid" }),
    });
    renderApp("/login");
    await userEvent.type(await screen.findByLabelText("電子郵件"), "x@example.com");
    await userEvent.type(screen.getByLabelText("密碼"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "登入" }));
    expect(await screen.findByText("電子郵件或密碼錯誤")).toBeInTheDocument();
  });

  it("登入頁校驗必填欄位", async () => {
    mockApi({});
    renderApp("/login");
    await userEvent.click(await screen.findByRole("button", { name: "登入" }));
    expect(await screen.findByText("請輸入電子郵件")).toBeInTheDocument();
    expect(await screen.findByText("請輸入密碼")).toBeInTheDocument();
  });

  it("創作者看不到管理與審核，且直接進入管理頁顯示 403", async () => {
    mockApi({
      "GET /auth/me": makeUser({ roles: ["creator"], display_name: "小創" }),
      "GET /jobs": emptyJobs,
    });
    renderApp("/admin");
    expect(await screen.findByText("你沒有權限查看這個頁面")).toBeInTheDocument();
    const header = screen.getByTestId("current-user");
    expect(within(header).getByText("小創")).toBeInTheDocument();
    expect(within(header).getByText("創作者")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^審核/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "片場" })).toBeInTheDocument();
    await userEvent.click(header);
    expect(await screen.findByRole("link", { name: "用量" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "管理" })).not.toBeInTheDocument();
  });

  it("管理員看得到管理與審核，審核顯示待審數量", async () => {
    mockApi({
      "GET /auth/me": makeUser(),
      "GET /jobs": emptyJobs,
      "GET /reviews/queue": [makeJobSummary({ status: "in_review" })],
    });
    renderApp("/jobs");
    expect(await screen.findByRole("link", { name: /^審核.*1 支待審核/ })).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("current-user"));
    expect(await screen.findByRole("link", { name: "管理" })).toBeInTheDocument();
  });

  it("頂部顯示 HH:MM:SS:FF 時間碼", async () => {
    mockApi({ "GET /auth/me": makeUser(), "GET /jobs": emptyJobs });
    renderApp("/jobs");
    expect((await screen.findByRole("timer")).textContent).toMatch(/^TC \d{2}:\d{2}:\d{2}:\d{2}$/);
  });

  it("登出後回到登入頁", async () => {
    let loggedIn = true;
    const api = mockApi({
      "GET /auth/me": () => (loggedIn ? makeUser() : json(401, { detail: "未登入" })),
      "POST /auth/logout": () => {
        loggedIn = false;
        return json(204);
      },
      "GET /jobs": emptyJobs,
    });
    renderApp("/jobs");
    await userEvent.click(await screen.findByTestId("current-user"));
    await userEvent.click(await screen.findByText("登出"));
    expect(await screen.findByRole("button", { name: "登入" })).toBeInTheDocument();
    expect(api.find("POST", "/auth/logout")).toHaveLength(1);
  });

  it("任務列表顯示狀態與進度，篩選會帶入查詢參數", async () => {
    const api = mockApi({
      "GET /auth/me": makeUser(),
      "GET /jobs": {
        items: [
          makeJobSummary({
            status: "generating",
            progress: { total: 4, succeeded: 2, failed: 0 },
          }),
        ],
        total: 1,
      },
    });
    renderApp("/jobs?status=generating&mine=1");
    expect(await screen.findByRole("link", { name: "綠茶推廣" })).toBeInTheDocument();
    expect(screen.getAllByText("生成中").length).toBeGreaterThan(0);
    expect(screen.getByText("2/4")).toBeInTheDocument();
    await waitFor(() => expect(api.find("GET", "/jobs").length).toBeGreaterThan(0));
    expect(api.find("GET", "/jobs")[0]?.path).toContain("status=generating");
    expect(api.find("GET", "/jobs")[0]?.path).toContain("mine=true");
  });

  it("可切換為簡體中文", async () => {
    await i18n.changeLanguage("zh-CN");
    mockApi({ "GET /auth/me": makeUser(), "GET /jobs": emptyJobs });
    renderApp("/jobs");
    expect(await screen.findByRole("heading", { name: "全部任务" })).toBeInTheDocument();
    await i18n.changeLanguage("zh-TW");
  });
});

describe("safeRedirect", () => {
  it("只接受站內路徑", () => {
    expect(safeRedirect("/jobs/1")).toBe("/jobs/1");
    expect(safeRedirect(null)).toBe("/jobs");
    expect(safeRedirect("//evil.example")).toBe("/jobs");
    expect(safeRedirect("https://evil.example")).toBe("/jobs");
    expect(safeRedirect("/login")).toBe("/jobs");
  });
});
