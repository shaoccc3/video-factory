import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeJob, makeJobSummary, makeTemplate, makeUser } from "../test/fixtures";
import type { RecordedCall } from "../test/utils";
import { mockApi, renderApp } from "../test/utils";

const templates = [
  makeTemplate(),
  makeTemplate({
    id: "tpl-training",
    key: "training",
    name: "培訓講解片",
    min_duration_s: 60,
    max_duration_s: 180,
  }),
];

function jobsRoute(call: RecordedCall) {
  const query = new URLSearchParams(call.path.split("?")[1] ?? "");
  const statuses = query.getAll("status");
  if (statuses.includes("generating")) {
    return {
      items: [
        makeJobSummary({
          id: "j-sb",
          title: "清晨的茶園",
          status: "storyboard_ready",
          progress: { total: 2, succeeded: 0, failed: 0 },
        }),
        makeJobSummary({
          id: "j-gen",
          title: "釣魚郵件培訓",
          status: "generating",
          progress: { total: 6, succeeded: 3, failed: 0 },
        }),
      ],
      total: 2,
    };
  }
  if (statuses.includes("in_review")) {
    return {
      items: [
        makeJobSummary({
          id: "j-film",
          title: "海岸日落",
          status: "approved",
          final_asset_id: "f-1",
          cover_asset_id: "c-1",
        }),
      ],
      total: 1,
    };
  }
  return { items: [], total: 0 };
}

describe("片場首頁", () => {
  it("顯示放映區、片場底片的狀態與主要動作", async () => {
    const api = mockApi({
      "GET /auth/me": makeUser(),
      "GET /templates": templates,
      "GET /jobs": jobsRoute,
      "GET /reviews/queue": [],
    });
    renderApp("/");
    expect(await screen.findByRole("heading", { name: "海岸日落" })).toBeInTheDocument();
    const strip = (await screen.findByRole("heading", { name: "片場" })).closest(
      "section",
    ) as HTMLElement;
    expect(await within(strip).findByRole("link", { name: "清晨的茶園" })).toHaveAttribute(
      "href",
      "/jobs/j-sb",
    );
    expect(within(strip).getByText("待確認分鏡")).toBeInTheDocument();
    expect(within(strip).getByRole("link", { name: "去確認分鏡" })).toHaveAttribute(
      "href",
      "/jobs/j-sb",
    );
    expect(within(strip).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "3");
    const stripCall = api.find("GET", "/jobs").find((c) => c.path.includes("status=generating"));
    expect(stripCall?.path).toContain("sort=updated");
    expect(stripCall?.path).toContain("status=storyboard_ready");
  });

  it("沒有想法時提示；寫好後建立並提交任務，再進入分鏡表", async () => {
    const api = mockApi({
      "GET /auth/me": makeUser(),
      "GET /templates": templates,
      "GET /jobs": jobsRoute,
      "GET /reviews/queue": [],
      "POST /jobs": makeJob({ id: "new-1" }),
      "POST /jobs/new-1/submit": makeJob({ id: "new-1", status: "scripting" }),
      "GET /jobs/new-1": makeJob({ id: "new-1", status: "scripting" }),
      "GET /jobs/new-1/events": { __response: true, status: 204 },
    });
    renderApp("/");
    const go = await screen.findByRole("button", { name: /寫分鏡/ });
    await userEvent.click(go);
    expect(await screen.findByText("先寫下想法")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /培訓講解片/ }));
    await userEvent.type(screen.getByLabelText(/SCENE 00/), "清晨的茶園，推廣自家綠茶");
    await userEvent.click(go);
    await waitFor(() => expect(api.find("POST", "/jobs/new-1/submit")).toHaveLength(1));
    expect(api.find("POST", "/jobs")[0]?.body).toEqual({
      template_id: "tpl-training",
      title: "清晨的茶園，推廣自家綠茶",
      inputs: { topic: "清晨的茶園，推廣自家綠茶" },
    });
  });

  it("沒有成片也沒有進行中的片時顯示空狀態", async () => {
    mockApi({
      "GET /auth/me": makeUser(),
      "GET /templates": templates,
      "GET /jobs": { items: [], total: 0 },
      "GET /reviews/queue": [],
    });
    renderApp("/");
    expect(await screen.findByText("第一支片還沒上映")).toBeInTheDocument();
    expect(await screen.findByText("片場目前沒有進行中的片。")).toBeInTheDocument();
    expect(screen.getByText("還沒有通過的成片。")).toBeInTheDocument();
  });
});
