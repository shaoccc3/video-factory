import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CHECKLIST_KEYS } from "../api/types";
import { makeJob, makeJobSummary, makeUser } from "../test/fixtures";
import { mockApi, renderApp } from "../test/utils";

const reviewJob = makeJob({
  status: "in_review",
  final_asset_id: "final-1",
  allowed_actions: ["review"],
});

const CHECKLIST_LABELS = [
  "AI 生成標識存在（片頭與角落）",
  "無未授權真人肖像",
  "無第三方品牌或影視 IP",
  "符合品牌規範",
  "字幕無錯字",
];

function routes() {
  return {
    "GET /auth/me": makeUser(),
    "GET /reviews/queue": [makeJobSummary({ status: "in_review", final_asset_id: "final-1" })],
    "GET /jobs/job-1": reviewJob,
    "GET /jobs/job-1/calls": [],
    "POST /jobs/job-1/review": (call: { body: unknown }) => {
      const body = call.body as { decision: "approved" | "rejected" };
      return {
        ...reviewJob,
        status: body.decision,
        allowed_actions: body.decision === "approved" ? ["download"] : [],
      };
    },
  };
}

describe("審核台", () => {
  it("佇列列出待審核任務並可進入審核頁", async () => {
    mockApi(routes());
    renderApp("/reviews");
    await userEvent.click(await screen.findByRole("link", { name: "綠茶推廣" }));
    expect(await screen.findByTestId("final-video")).toBeInTheDocument();
  });

  it("五項清單全部勾選前不能通過，勾完後送出完整清單", async () => {
    const api = mockApi(routes());
    renderApp("/reviews/job-1");
    const approve = await screen.findByRole("button", { name: /通過/ });
    expect(approve).toBeDisabled();
    expect(screen.getByText("五項全部勾選後才能通過")).toBeInTheDocument();

    for (const label of CHECKLIST_LABELS.slice(0, 4)) {
      await userEvent.click(screen.getByRole("checkbox", { name: label }));
    }
    expect(approve).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: CHECKLIST_LABELS[4] ?? "" }));
    expect(approve).toBeEnabled();
    await userEvent.click(approve);

    await waitFor(() => expect(api.find("POST", "/jobs/job-1/review")).toHaveLength(1));
    expect(api.find("POST", "/jobs/job-1/review")[0]?.body).toEqual({
      decision: "approved",
      checklist: Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, true])),
      reason: "",
    });
    // 通過後回到任務詳情，後端給了 download 動作
    expect(await screen.findByTestId("download-final")).toBeInTheDocument();
  });

  it("退回必須填寫原因", async () => {
    const api = mockApi(routes());
    renderApp("/reviews/job-1");
    const reject = await screen.findByRole("button", { name: /退回/ });
    await userEvent.click(reject);
    expect(await screen.findByText("退回時必須填寫原因")).toBeInTheDocument();
    expect(api.find("POST", "/jobs/job-1/review")).toHaveLength(0);

    await userEvent.type(screen.getByLabelText("意見／退回原因"), "片尾字幕有錯字");
    await userEvent.click(reject);
    await waitFor(() => expect(api.find("POST", "/jobs/job-1/review")).toHaveLength(1));
    expect(api.find("POST", "/jobs/job-1/review")[0]?.body).toMatchObject({
      decision: "rejected",
      reason: "片尾字幕有錯字",
    });
  });

  it("任務沒有 review 動作時不顯示表單", async () => {
    mockApi({ ...routes(), "GET /jobs/job-1": { ...reviewJob, allowed_actions: [] } });
    renderApp("/reviews/job-1");
    expect(await screen.findByText("這個任務目前不需要審核")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /通過/ })).not.toBeInTheDocument();
  });

  it("非審核者不能進入審核台", async () => {
    mockApi({ ...routes(), "GET /auth/me": makeUser({ roles: ["creator"] }) });
    renderApp("/reviews");
    expect(await screen.findByText("你沒有權限查看這個頁面")).toBeInTheDocument();
  });
});
