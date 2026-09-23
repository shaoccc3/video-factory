import { describe, expect, it } from "vitest";
import { makeScene } from "../../test/fixtures";
import {
  cameraMotion,
  countChars,
  effectiveScene,
  narrationLimit,
  pruneEdits,
  sceneDiff,
  shotAt,
  shotStarts,
  toFormValues,
} from "./shots";

describe("分鏡表的純函數", () => {
  it("sceneDiff 只回傳與後端不同的欄位", () => {
    const scene = makeScene();
    const values = { ...toFormValues(scene), narration: "晨霧", duration_s: 6 };
    expect(sceneDiff(scene, values)).toEqual({ narration: "晨霧", duration_s: 6 });
    expect(sceneDiff(scene, toFormValues(scene))).toEqual({});
  });

  it("草稿只存改過的欄位：後端更新其他欄位（例如首幀）不會被舊值蓋回", () => {
    const scene = makeScene();
    const edits = { narration: "晨霧" };
    const updated = { ...scene, first_frame_asset_id: "kf-1" };
    const shown = effectiveScene(updated, edits);
    expect(shown.first_frame_asset_id).toBe("kf-1");
    expect(sceneDiff(updated, toFormValues(shown))).toEqual({ narration: "晨霧" });
  });

  it("pruneEdits 移除後端已是這個值的修改，保留還在打字的欄位", () => {
    const scene = makeScene({ narration: "晨霧" });
    expect(pruneEdits(scene, { narration: "晨霧" })).toBeUndefined();
    expect(pruneEdits(scene, { narration: "晨霧裡", speaker: "旁白" })).toEqual({
      narration: "晨霧裡",
    });
  });

  it("旁白字數以 Unicode 字元計，建議上限 = floor(時長 × 每秒字數)", () => {
    expect(countChars("茶🍵")).toBe(2);
    expect(narrationLimit(5, 3.5)).toBe(17);
  });

  it("運鏡文字對應示意動畫（繁簡與英文皆可）", () => {
    expect(
      ["緩慢推進", "拉遠", "環繞", "环绕", "橫移", "摇镜", "固定鏡頭", "dolly in", "航拍"].map(
        cameraMotion,
      ),
    ).toEqual(["push", "pull", "orbit", "orbit", "pan", "pan", "breathe", "push", "kb"]);
  });

  it("播放頭落在哪一鏡", () => {
    const starts = shotStarts([{ duration_s: 5 }, { duration_s: 7.5 }, { duration_s: 4 }]);
    expect(starts).toEqual([0, 5, 12.5]);
    expect([0, 4.9, 5, 12.4, 12.5, 99].map((t) => shotAt(starts, t))).toEqual([0, 0, 1, 1, 2, 2]);
  });
});
