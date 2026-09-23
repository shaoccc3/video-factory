import { describe, expect, it } from "vitest";
import zhCN from "./locales/zh-CN.json";
import zhTW from "./locales/zh-TW.json";

function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("i18n", () => {
  it("繁簡兩套文案的鍵一致", () => {
    expect(keys(zhCN).sort()).toEqual(keys(zhTW).sort());
  });
});
