import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import "../i18n";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// 單元測試禁止真實網絡：沒有 mock 的 fetch 一律失敗
globalThis.fetch = () => Promise.reject(new Error("測試中不允許真實網絡請求，請使用 mockApi"));

// jsdom 沒有 matchMedia，Ant Design 的響應式組件需要它
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// jsdom 沒有 ResizeObserver，Ant Design 的 Menu、Table 需要它
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;
