import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Batch } from "../api/types";
import { makeJobSummary, makeTemplate, makeUser } from "../test/fixtures";
import { mockApi, renderApp } from "../test/utils";

const batch: Batch = {
  id: "b1c2d3e4-0000-0000-0000-000000000000",
  template_id: "tpl-marketing",
  template_name: "行銷短影音",
  total: 5,
  max_parallel: 2,
  status: "running",
  created_at: "2026-09-23T00:00:00Z",
  counts: { generating: 2, approved: 2, failed: 1 },
};

const quick = makeTemplate({
  id: "tpl-quick",
  key: "quick",
  name: "圖文轉短片",
  video_type: "quick",
});

function fileInput(dialog: HTMLElement): HTMLInputElement {
  const input = dialog.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("找不到檔案輸入框");
  return input;
}

describe("批量", () => {
  it("清單一列一卷：批次碼、模板、分段進度與各狀態數量", async () => {
    mockApi({ "GET /auth/me": makeUser(), "GET /batches": [batch] });
    renderApp("/batches");
    const link = await screen.findByRole("link", { name: "行銷短影音" });
    expect(link).toHaveAttribute("href", `/batches/${batch.id}`);
    const row = link.closest("li") as HTMLElement;
    expect(within(row).getByText("0923-B1C2")).toBeInTheDocument();
    expect(within(row).getByText("5 支 · 同時 2 支", { exact: false })).toBeInTheDocument();
    const counts = within(row)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(counts).toEqual(["生成中 2", "已通過 2", "失敗 1"]);
    expect(row.querySelectorAll(".vf-seg")).toHaveLength(3);
  });

  it("上傳 CSV 建立批量並進入詳情的底片網格", async () => {
    const api = mockApi({
      "GET /auth/me": makeUser(),
      "GET /batches": [],
      "GET /templates": [makeTemplate(), quick],
      "POST /batches/csv": batch,
      "GET /batches/b1c2d3e4-0000-0000-0000-000000000000": {
        ...batch,
        jobs: [makeJobSummary({ batch_id: batch.id, status: "generating" })],
      },
    });
    renderApp("/batches");
    await userEvent.click(await screen.findByRole("button", { name: "建立批量" }));
    const dialog = await screen.findByRole("dialog");

    // 沒選模板與檔案時就地提示
    await userEvent.click(within(dialog).getByRole("button", { name: "建立批量" }));
    expect(within(dialog).getByText("請選擇模板")).toBeInTheDocument();
    expect(within(dialog).getByText("請選擇檔案")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("combobox"));
    await userEvent.click(await screen.findByTitle("行銷短影音"));
    fireEvent.change(fileInput(dialog), {
      target: { files: [new File(["title,topic,extra\n"], "jobs.csv", { type: "text/csv" })] },
    });
    expect(within(dialog).getByText("jobs.csv")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "增加 1" }));
    await userEvent.click(within(dialog).getByRole("switch"));
    await userEvent.click(within(dialog).getByRole("button", { name: "建立批量" }));

    expect(await screen.findByRole("heading", { name: "批量：行銷短影音" })).toBeInTheDocument();
    const form = api.find("POST", "/batches/csv")[0]?.body as FormData;
    expect(form.get("template_id")).toBe("tpl-marketing");
    expect(form.get("max_parallel")).toBe("3");
    expect(form.get("draft_mode")).toBe("true");
    expect(screen.getByRole("link", { name: "綠茶推廣" })).toHaveAttribute("href", "/jobs/job-1");
  });

  it("多張圖片只能選圖文轉短片模板，並需要共同的想法", async () => {
    const api = mockApi({
      "GET /auth/me": makeUser(),
      "GET /batches": [],
      "GET /templates": [makeTemplate(), quick],
      "POST /batches/images": { ...batch, template_id: "tpl-quick", template_name: "圖文轉短片" },
      "GET /batches/b1c2d3e4-0000-0000-0000-000000000000": { ...batch, jobs: [] },
    });
    renderApp("/batches");
    await userEvent.click(await screen.findByRole("button", { name: "建立批量" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "多張圖片" }));
    await userEvent.click(within(dialog).getByRole("combobox"));
    expect(await screen.findByTitle("圖文轉短片")).toBeInTheDocument();
    expect(screen.queryByTitle("行銷短影音")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTitle("圖文轉短片"));
    fireEvent.change(fileInput(dialog), {
      target: {
        files: [
          new File(["a"], "a.png", { type: "image/png" }),
          new File(["b"], "b.png", { type: "image/png" }),
        ],
      },
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "建立 2 個任務" }));
    expect(within(dialog).getByText("請輸入共用提示詞")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("textbox"), "茶杯特寫");
    await userEvent.click(within(dialog).getByRole("button", { name: "建立 2 個任務" }));
    await waitFor(() => expect(api.find("POST", "/batches/images")).toHaveLength(1));
    const form = api.find("POST", "/batches/images")[0]?.body as FormData;
    expect(form.get("topic")).toBe("茶杯特寫");
    expect(form.getAll("files")).toHaveLength(2);
  });
});
