import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { applyJobDetail } from "../../api/hooks";
import type { JobDetail, Scene, SceneUpdate } from "../../api/types";
import { effectiveScene, pruneEdits, type SceneEdits, sceneDiff, toFormValues } from "./shots";

/** 停止輸入後多久自動儲存（規格 14：800ms） */
export const AUTOSAVE_MS = 800;

export type SaveState = "saved" | "editing" | "saving" | "invalid" | "error";

type Edits = Record<string, SceneEdits>;

interface DirtyScene {
  scene: Scene;
  body: SceneUpdate;
}

function isValid(scene: Scene, body: SceneUpdate): boolean {
  return (body.visual_prompt ?? scene.visual_prompt).trim().length > 0;
}

/**
 * 還沒寫回後端的修改。首幀預覽生成中（keyframe）的鏡頭先不存：
 * 後端會回 409，等鏡頭回到 pending 再存。
 */
function computeDirty(scenes: readonly Scene[], edits: Edits): DirtyScene[] {
  return scenes.flatMap((scene) => {
    const sceneEdits = edits[scene.id];
    if (!sceneEdits || scene.status === "keyframe") return [];
    const body = sceneDiff(scene, toFormValues(effectiveScene(scene, sceneEdits)));
    return Object.keys(body).length > 0 ? [{ scene, body }] : [];
  });
}

/** 送出後，值沒有再變的欄位就不再是未儲存的修改（後端若正規化了值，以後端為準） */
function dropSent(edits: SceneEdits | undefined, body: SceneUpdate): SceneEdits | undefined {
  if (!edits) return undefined;
  const rest: SceneEdits = { ...edits };
  for (const [key, value] of Object.entries(body)) {
    const field = key as keyof SceneEdits;
    if (rest[field] === value) delete rest[field];
  }
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/** 修改與後端值相同的欄位不必留著，否則會遮住後端之後的新值 */
function pruneAll(scenes: readonly Scene[], edits: Edits): Edits {
  const next: Edits = {};
  for (const scene of scenes) {
    const sceneEdits = edits[scene.id];
    const rest = sceneEdits ? pruneEdits(scene, sceneEdits) : undefined;
    if (rest) next[scene.id] = rest;
  }
  return next;
}

/**
 * 分鏡表的草稿與自動儲存：修改先存在本地（只存改過的欄位），停止輸入 800ms 後逐鏡 PATCH。
 * 切換鏡頭不會丟失修改；離開頁面時把還沒送出的修改送出；畫面描述空白時不存並指出是哪一鏡。
 */
export function useShotDrafts(job: JobDetail, editable: boolean) {
  const client = useQueryClient();
  const [edits, setEditsState] = useState<Edits>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /** 送出前發現畫面描述空白的鏡頭（index） */
  const [blocked, setBlocked] = useState<number | null>(null);
  // 以 ref 保存最新的修改與後端分鏡，儲存流程在 await 之後也讀得到最新值
  const editsRef = useRef<Edits>({});
  const scenesRef = useRef(job.scenes);
  scenesRef.current = job.scenes;
  const inflight = useRef<Promise<boolean> | null>(null);

  const setEdits = useCallback((update: (cur: Edits) => Edits) => {
    const next = update(editsRef.current);
    editsRef.current = next;
    setEditsState(next);
  }, []);

  // 後端的分鏡更新時（儲存完成、SSE 推送），清掉已經與後端一致的修改
  useEffect(() => {
    setEdits((cur) => pruneAll(job.scenes, cur));
  }, [job.scenes, setEdits]);

  const scenes = useMemo(
    () => job.scenes.map((scene) => effectiveScene(scene, edits[scene.id])),
    [job.scenes, edits],
  );
  const dirty = useMemo(() => computeDirty(job.scenes, edits), [job.scenes, edits]);
  const invalid = dirty.some((d) => !isValid(d.scene, d.body));

  const edit = useCallback(
    (sceneId: string, patch: SceneEdits) => {
      setEdits((cur) =>
        pruneAll(scenesRef.current, { ...cur, [sceneId]: { ...cur[sceneId], ...patch } }),
      );
      setError(null);
      setBlocked(null);
    },
    [setEdits],
  );

  /** 立即儲存所有修改（先等進行中的儲存完成）；全部寫回後回傳 true */
  const flush = useCallback(async (): Promise<boolean> => {
    while (inflight.current) await inflight.current;
    const batch = computeDirty(scenesRef.current, editsRef.current);
    const bad = batch.find((d) => !isValid(d.scene, d.body));
    if (bad) {
      setBlocked(bad.scene.index);
      return false;
    }
    if (batch.length === 0) return true;
    const run = (async () => {
      setSaving(true);
      setError(null);
      try {
        for (const { scene, body } of batch) {
          const updated = await api.updateScene(job.id, scene.id, body);
          applyJobDetail(client, updated);
          setEdits((cur) => {
            const next = { ...cur };
            const rest = dropSent(next[scene.id], body);
            if (rest) next[scene.id] = rest;
            else delete next[scene.id];
            return next;
          });
        }
        return true;
      } catch (err) {
        setError(err);
        return false;
      } finally {
        setSaving(false);
      }
    })();
    inflight.current = run;
    try {
      return await run;
    } finally {
      inflight.current = null;
    }
  }, [client, job.id, setEdits]);

  useEffect(() => {
    if (!editable || saving || error || invalid || dirty.length === 0) return;
    const timer = window.setTimeout(() => void flush(), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [editable, saving, error, invalid, dirty, flush]);

  // 還有未送出的修改時，關閉分頁前提醒
  const hasDirty = dirty.length > 0;
  useEffect(() => {
    if (!hasDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasDirty]);

  // 站內換頁時把還沒送出的修改送出（不等結果；正在送的欄位可能重送一次，結果相同）
  const jobId = job.id;
  useEffect(
    () => () => {
      if (!editable) return;
      for (const { scene, body } of computeDirty(scenesRef.current, editsRef.current)) {
        if (!isValid(scene, body)) continue;
        api
          .updateScene(jobId, scene.id, body)
          .then((updated) => applyJobDetail(client, updated))
          .catch(() => {});
      }
    },
    [client, jobId, editable],
  );

  const state: SaveState = error
    ? "error"
    : invalid
      ? "invalid"
      : saving
        ? "saving"
        : dirty.length > 0
          ? "editing"
          : "saved";

  return { scenes, edit, flush, state, error, blocked };
}
