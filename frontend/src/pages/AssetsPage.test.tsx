import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Asset } from "../api/types";
import { makeUser } from "../test/fixtures";
import { mockApi, renderApp } from "../test/utils";
import { accepts, guessKind } from "./AssetsPage";

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

function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("找不到檔案輸入框");
  return input;
}

describe("素材", () => {
  it("印樣表列出素材的等寬編號與類型，點開抽屜看預覽、標籤與用途", async () => {
    mockApi({
      "GET /auth/me": makeUser(),
      "GET /assets": {
        items: [makeAsset(), makeAsset({ id: "a-2", display_name: "標誌.svg", kind: "logo" })],
        total: 2,
      },
    });
    renderApp("/assets");
    const cell = await screen.findByRole("button", { name: "茶罐.png" });
    expect(within(cell).getByText("#0001")).toBeInTheDocument();
    expect(within(cell).getByText("商品圖")).toBeInTheDocument();
    expect(within(cell).getByAltText("茶罐.png")).toHaveAttribute(
      "src",
      "/api/v1/assets/a-1/thumbnail",
    );
    expect(
      within(screen.getByRole("button", { name: "標誌.svg" })).getByText("#0002"),
    ).toBeInTheDocument();

    await userEvent.click(cell);
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByRole("img", { name: "茶罐.png" })).toHaveAttribute(
      "src",
      "/api/v1/assets/a-1/content",
    );
    expect(within(drawer).getByText("綠茶")).toBeInTheDocument();
    expect(within(drawer).getByText("開新片時的商品圖，也可作為首幀參考。")).toBeInTheDocument();
    expect(within(drawer).getByText("800×800")).toBeInTheDocument();
  });

  it("類型頁籤重新查詢", async () => {
    const api = mockApi({
      "GET /auth/me": makeUser(),
      "GET /assets": { items: [makeAsset()], total: 1 },
    });
    renderApp("/assets");
    await screen.findByRole("button", { name: "茶罐.png" });
    await userEvent.click(screen.getByRole("button", { name: "背景音樂" }));
    await waitFor(() => expect(api.find("GET", "/assets").at(-1)?.path).toContain("kind=bgm"));
    await userEvent.click(screen.getByRole("button", { name: "成片" }));
    await waitFor(() => expect(api.find("GET", "/assets").at(-1)?.path).toContain("kind=final"));
  });

  it("拖曳上傳條：選檔後依檔案猜類型，可改類型並加標籤，以 multipart 上傳", async () => {
    const api = mockApi({
      "GET /auth/me": makeUser(),
      "GET /assets": { items: [], total: 0 },
      "POST /assets": makeAsset({ id: "a-2", kind: "logo" }),
    });
    renderApp("/assets");
    expect(await screen.findByText("目前沒有素材")).toBeInTheDocument();
    const file = new File(["png"], "logo.png", { type: "image/png" });
    fireEvent.change(fileInput(), { target: { files: [file] } });

    expect(await screen.findByText("logo.png")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("combobox", { name: "類型" }));
    await userEvent.click(await screen.findByTitle("Logo"));
    await userEvent.type(screen.getByLabelText("標籤"), "品牌, 深色版");
    await userEvent.click(screen.getByRole("button", { name: "上傳素材" }));

    await waitFor(() => expect(api.find("POST", "/assets")).toHaveLength(1));
    const form = api.find("POST", "/assets")[0]?.body as FormData;
    expect(form.get("kind")).toBe("logo");
    expect(form.get("tags")).toBe("品牌,深色版");
    expect((form.get("file") as File).name).toBe("logo.png");
  });

  it("拖進不支援的檔案類型時就地提示，不上傳", async () => {
    const api = mockApi({
      "GET /auth/me": makeUser(),
      "GET /assets": { items: [], total: 0 },
    });
    renderApp("/assets");
    const strip = await screen.findByRole("region", { name: "上傳素材" });
    const file = new File(["x"], "notes.exe", { type: "application/octet-stream" });
    fireEvent.drop(strip, { dataTransfer: { files: [file] } });
    expect(await screen.findByText("「notes.exe」的檔案類型不支援")).toBeInTheDocument();
    expect(api.find("POST", "/assets")).toHaveLength(0);
  });
});

describe("上傳檔案的判斷", () => {
  it("依 MIME 或副檔名比對 accept，並猜素材類型", () => {
    const png = new File([""], "a.png", { type: "image/png" });
    const svg = new File([""], "b.svg", { type: "image/svg+xml" });
    const mp3 = new File([""], "c.mp3", { type: "audio/mpeg" });
    const ttf = new File([""], "d.TTF", { type: "" });
    expect(accepts("image/png,image/jpeg", png)).toBe(true);
    expect(accepts(".ttf,.otf", ttf)).toBe(true);
    expect(accepts("image/png", mp3)).toBe(false);
    expect([png, svg, mp3, ttf].map(guessKind)).toEqual(["product", "logo", "bgm", "font"]);
  });
});
