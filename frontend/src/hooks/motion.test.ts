import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { formatSeconds, formatTimecode, usePrefersReducedMotion } from "./motion";

describe("時間碼", () => {
  it("HH:MM:SS:FF，幀數以 24fps 計", () => {
    expect(formatTimecode(new Date(2026, 8, 23, 9, 4, 37, 500))).toBe("09:04:37:12");
  });

  it("秒數轉 MM:SS:FF", () => {
    expect(formatSeconds(0)).toBe("00:00:00");
    expect(formatSeconds(75.5)).toBe("01:15:12");
    expect(formatSeconds(-3)).toBe("00:00:00");
  });
});

describe("減少動態效果", () => {
  it("跟隨系統設定並回應變更", () => {
    let listener: (() => void) | undefined;
    let matches = true;
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() {
        return matches;
      },
      media: query,
      addEventListener: (_: string, cb: () => void) => {
        listener = cb;
      },
      removeEventListener: () => {},
    }));
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
    matches = false;
    act(() => listener?.());
    expect(result.current).toBe(false);
  });
});
