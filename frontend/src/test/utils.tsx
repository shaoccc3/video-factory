import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { App } from "../App";

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
}

type Handler = (call: RecordedCall) => { status?: number; body?: unknown } | unknown;

export interface MockApi {
  calls: RecordedCall[];
  /** 找出某個方法與路徑（不含查詢字串）的所有請求 */
  find: (method: string, path: string) => RecordedCall[];
}

export function json(status: number, body?: unknown) {
  return { __response: true as const, status, body };
}

function isResponseSpec(
  value: unknown,
): value is { __response: true; status: number; body: unknown } {
  return typeof value === "object" && value !== null && "__response" in value;
}

/**
 * 以 "METHOD /path" 為鍵的假後端；路徑不含 /api/v1 前綴與查詢字串。
 * 找不到對應時回 404，並記錄所有請求供斷言。
 */
export function mockApi(routes: Record<string, Handler | unknown>): MockApi {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/api\/v1/, "");
    let body: unknown = null;
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    else if (init?.body instanceof FormData) body = init.body;
    const call = { method, path: `${path}${url.search}`, body };
    calls.push(call);
    const route = routes[`${method} ${path}`];
    if (route === undefined) {
      return new Response(JSON.stringify({ detail: `no mock for ${method} ${path}` }), {
        status: 404,
      });
    }
    const result = typeof route === "function" ? (route as Handler)(call) : route;
    const spec = isResponseSpec(result) ? result : { status: 200, body: result };
    if (spec.status === 204 || spec.body === undefined) {
      return new Response(null, { status: spec.status === 200 ? 204 : spec.status });
    }
    return new Response(JSON.stringify(spec.body), {
      status: spec.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    find: (method, path) =>
      calls.filter((c) => c.method === method && c.path.split("?")[0] === path),
  };
}

export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
  });
}

export function renderApp(path: string) {
  return render(<App initialPath={path} queryClient={testQueryClient()} />);
}
