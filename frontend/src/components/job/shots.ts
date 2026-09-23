import type { Scene, SceneUpdate } from "../../api/types";

/** 分鏡表可編輯的欄位 */
export interface SceneFormValues {
  narration: string;
  visual_prompt: string;
  shot_type: string;
  camera_move: string;
  duration_s: number;
  screen_text: string;
  speaker: string;
  sound: string;
  needs_first_frame: boolean;
  first_frame_asset_id: string | null;
}

/** 使用者改過、還沒寫回後端的欄位（只存改過的欄位，後端更新其他欄位時不會被舊值蓋回去） */
export type SceneEdits = Partial<SceneFormValues>;

const FIELDS = [
  "narration",
  "visual_prompt",
  "shot_type",
  "camera_move",
  "duration_s",
  "screen_text",
  "speaker",
  "sound",
  "needs_first_frame",
  "first_frame_asset_id",
] as const satisfies readonly (keyof SceneFormValues)[];

export function toFormValues(scene: Scene): SceneFormValues {
  return {
    narration: scene.narration,
    visual_prompt: scene.visual_prompt,
    shot_type: scene.shot_type,
    camera_move: scene.camera_move,
    duration_s: scene.duration_s,
    screen_text: scene.screen_text,
    speaker: scene.speaker,
    sound: scene.sound,
    needs_first_frame: scene.needs_first_frame,
    first_frame_asset_id: scene.first_frame_asset_id,
  };
}

/** 畫面上看到的值：後端的值套上尚未儲存的修改 */
export function effectiveScene(scene: Scene, edits: SceneEdits | undefined): Scene {
  return edits ? { ...scene, ...edits } : scene;
}

/** 只送出與後端不同的欄位 */
export function sceneDiff(scene: Scene, values: SceneFormValues): SceneUpdate {
  const diff: SceneUpdate = {};
  for (const key of FIELDS) {
    if (values[key] !== scene[key]) Object.assign(diff, { [key]: values[key] });
  }
  return diff;
}

/** 後端已經是這個值的修改就不必再存；還在打字的欄位保留 */
export function pruneEdits(scene: Scene, edits: SceneEdits): SceneEdits | undefined {
  const rest: SceneEdits = {};
  for (const key of FIELDS) {
    if (key in edits && edits[key] !== scene[key]) Object.assign(rest, { [key]: edits[key] });
  }
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/** 旁白字數（按 Unicode 字元計，與後端 len() 一致） */
export function countChars(text: string): number {
  return Array.from(text).length;
}

/** 每鏡旁白建議上限 = floor(時長 × chars_per_second) */
export function narrationLimit(durationS: number, charsPerSecond: number): number {
  return Math.floor(durationS * charsPerSecond);
}

/** 監看畫面的運鏡示意：依運鏡文字挑一種動畫，對不上時用緩慢推移 */
export function cameraMotion(cameraMove: string): string {
  const move = cameraMove.toLowerCase();
  if (/拉|pull|zoom out|dolly out/.test(move)) return "pull";
  if (/環繞|环绕|orbit|arc/.test(move)) return "orbit";
  if (/推|push|zoom in|dolly in/.test(move)) return "push";
  if (/移|搖|摇|跟|pan|track|truck/.test(move)) return "pan";
  if (/固定|static|fixed|lock/.test(move)) return "breathe";
  return "kb";
}

/** 每個鏡頭在整支片裡的起點（秒） */
export function shotStarts(scenes: readonly { duration_s: number }[]): number[] {
  const starts: number[] = [];
  let t = 0;
  for (const s of scenes) {
    starts.push(t);
    t += s.duration_s;
  }
  return starts;
}

/** 時間點落在哪一鏡；超出總長時回最後一鏡 */
export function shotAt(starts: readonly number[], time: number): number {
  let index = 0;
  for (let i = 0; i < starts.length; i += 1) {
    if ((starts[i] ?? 0) <= time) index = i;
  }
  return index;
}

/** 鏡頭編號：01、02… */
export function shotNo(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/** 秒數去掉多餘的小數：5、7.5 */
export function formatShotSeconds(seconds: number): string {
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}
