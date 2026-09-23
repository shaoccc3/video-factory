import { describe, expect, it, vi } from "vitest";
import { ApiError, api, buildQuery, request } from "./client";

function stubFetch(response: Response | Error) {
  const fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("request", () => {
  it("帶 Cookie、JSON 編碼並解析回應", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ id: "u-1" }), { status: 200 }));
    const user = await api.login({ email: "a@example.com", password: "pw" });
    expect(user).toEqual({ id: "u-1" });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/auth/login");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(init?.body).toBe(JSON.stringify({ email: "a@example.com", password: "pw" }));
  });

  it("204 回傳 undefined", async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(api.logout()).resolves.toBeUndefined();
  });

  it("非 2xx 丟出帶 status 與 detail 的 ApiError", async () => {
    stubFetch(new Response(JSON.stringify({ detail: "預算不足" }), { status: 409 }));
    const error = await api.confirmStoryboard("job-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(409);
    expect(apiError.detail).toBe("預算不足");
    expect(apiError.message).toBe("預算不足");
  });

  it("422 的校驗錯誤陣列轉為可讀訊息", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          detail: [
            { loc: ["body", "inputs", "topic"], msg: "Field required" },
            { loc: ["body"], msg: "invalid" },
          ],
        }),
        { status: 422 },
      ),
    );
    const error = (await request("/jobs", { method: "POST", json: {} }).catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(error.status).toBe(422);
    expect(Array.isArray(error.detail)).toBe(true);
    expect(error.message).toBe("inputs.topic: Field required; invalid");
  });

  it("非 JSON 的錯誤內容也能處理", async () => {
    stubFetch(new Response("Bad Gateway", { status: 502 }));
    const error = (await api.me().catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(502);
    expect(error.message).toBe("Bad Gateway");
  });

  it("沒有內容的錯誤使用 HTTP 狀態碼", async () => {
    stubFetch(new Response("", { status: 500 }));
    const error = (await api.me().catch((e: unknown) => e)) as ApiError;
    expect(error.message).toBe("HTTP 500");
  });

  it("網絡錯誤轉為 status 0 的 ApiError", async () => {
    stubFetch(new TypeError("Failed to fetch"));
    const error = (await api.me().catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
  });

  it("上傳素材使用 multipart，不手動設 Content-Type", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ id: "a-1" }), { status: 200 }));
    const file = new File(["x"], "logo.png", { type: "image/png" });
    await api.uploadAsset({ file, kind: "logo", tags: ["品牌", "主色"] });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    expect(form.get("kind")).toBe("logo");
    expect(form.get("tags")).toBe("品牌,主色");
    expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
  });

  it("單鏡頭重做送出 target", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ id: "job-1" }), { status: 200 }));
    await api.regenerateScene("job-1", "s-1", "video");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/jobs/job-1/scenes/s-1/regenerate");
    expect(init?.body).toBe(JSON.stringify({ target: "video" }));
  });
});

describe("buildQuery", () => {
  it("略過空值並編碼", () => {
    expect(buildQuery({ status: "draft", q: "", mine: true, page: 2, x: undefined })).toBe(
      "?status=draft&mine=true&page=2",
    );
    expect(buildQuery({ q: "茶 園" })).toBe("?q=%E8%8C%B6+%E5%9C%92");
    expect(buildQuery({})).toBe("");
  });

  it("列表請求帶上篩選參數", async () => {
    const fetchMock = stubFetch(
      new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }),
    );
    await api.listJobs({ status: "in_review", mine: true, page: 1, page_size: 20 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/jobs?status=in_review&mine=true&page=1&page_size=20",
    );
  });
});
