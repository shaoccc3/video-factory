import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { applyJobDetail } from "../../api/hooks";
import type { JobDetail, Scene, SceneUpdate } from "../../api/types";
import { effectiveScene, type SceneEdits, sceneDiff, toFormValues } from "./shots";

/** 停止輸入後多久自動儲存（規格 14：800ms） */
export const AUTOSAVE_MS = 800;

export type SaveState = "saved" | "editing" | "saving" | "invalid" | "error";

interface DirtyScene {
  scene: Scene;
  body: SceneUpdate;
}

function isValid(scene: Scene, body: SceneUpdate): boolean {
  return (body.visual_prompt ?? scene.visual_prompt).trim().length > 0;
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

/**
 * 分鏡表的草稿與自動儲存：修改先存在本地（只存改過的欄位），停止輸入 800ms 後逐鏡 PATCH。
 * 切換鏡頭不會丟失修改；離開頁面時把還沒送出的修改送出；畫面描述空白時不存。
 */
export function useShotDrafts(job: JobDetail, editable: boolean) {
  const client = useQueryClient();
  const [edits, setEdits] = useState<Record<string, SceneEdits>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const savingRef = useRef(false);

  const scenes = useMemo(
    () => job.scenes.map((scene) => effectiveScene(scene, edits[scene.id])),
    [job.scenes, edits],
  );

  const dirty = useMemo<DirtyScene[]>(
    () =>
      job.scenes.flatMap((scene) => {
        const sceneEdits = edits[scene.id];
        if (!sceneEdits) return [];
        const body = sceneDiff(scene, toFormValues(effectiveScene(scene, sceneEdits)));
        return Object.keys(body).length > 0 ? [{ scene, body }] : [];
      }),
    [job.scenes, edits],
  );
  const invalid = dirty.some((d) => !isValid(d.scene, d.body));
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const edit = useCallback((sceneId: string, patch: SceneEdits) => {
    setEdits((cur) => ({ ...cur, [sceneId]: { ...cur[sceneId], ...patch } }));
    setError(null);
  }, []);

  /** 立即儲存所有修改；全部寫回後回傳 true */
  const flush = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) return false;
    const batch = dirtyRef.current;
    if (batch.some((d) => !isValid(d.scene, d.body))) return false;
    if (batch.length === 0) return true;
    savingRef.current = true;
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
      savingRef.current = false;
      setSaving(false);
    }
  }, [client, job.id]);

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

  // 站內換頁時把還沒送出的修改送出（不等結果）
  const jobId = job.id;
  useEffect(
    () => () => {
      if (!editable || savingRef.current) return;
      for (const { scene, body } of dirtyRef.current) {
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

  return { scenes, edit, flush, state, error };
}
