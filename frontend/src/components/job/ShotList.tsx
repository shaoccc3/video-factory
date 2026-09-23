import { Popconfirm } from "antd";
import { type CSSProperties, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, assetContentUrl, assetThumbnailUrl } from "../../api/client";
import { useEstimate, useJobCommand, useMeta } from "../../api/hooks";
import type { CostEstimate, JobDetail, Ratio, Scene } from "../../api/types";
import { useDocumentVisible, usePrefersReducedMotion } from "../../hooks/motion";
import { formatCny } from "../../utils/format";
import { AssetPicker } from "../AssetPicker";
import { ErrorAlert } from "../ErrorResult";
import { Toggle } from "../studio/Toggle";
import { formatRuntime, JobHeader, TechDetails } from "./JobHeader";
import {
  cameraMotion,
  countChars,
  formatShotSeconds,
  narrationLimit,
  type SceneEdits,
  shotAt,
  shotNo,
  shotStarts,
} from "./shots";
import { Timeline } from "./Timeline";
import { type SaveState, useShotDrafts } from "./useShotDrafts";
import "./shotlist.css";

const FPS = 24;

/** 時間碼 MM:SS:FF */
function timecode(seconds: number): string {
  const whole = Math.floor(seconds);
  const frames = Math.floor((seconds - whole) * FPS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(whole / 60))}:${pad(whole % 60)}:${pad(frames)}`;
}

/** 監看的播放頭：以 requestAnimationFrame 推進，每一格（1/24 秒）才更新一次；分頁在背景時暫停，播到結尾從頭循環 */
function usePlayhead(total: number) {
  const reduced = usePrefersReducedMotion();
  const visible = useDocumentVisible();
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(() => !reduced);
  const timeRef = useRef(0);

  useEffect(() => {
    if (!playing || !visible || total <= 0 || typeof requestAnimationFrame !== "function") return;
    let last = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const next = (timeRef.current + (now - last) / 1000) % total;
      last = now;
      if (Math.floor(next * FPS) !== Math.floor(timeRef.current * FPS)) setTime(next);
      timeRef.current = next;
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing, visible, total]);

  const getTime = useCallback(() => timeRef.current, []);
  const seek = useCallback(
    (seconds: number) => {
      const clamped = Math.max(0, Math.min(seconds, Math.max(total - 0.001, 0)));
      timeRef.current = clamped;
      setTime(clamped);
    },
    [total],
  );
  return { time: Math.min(time, total), playing, setPlaying, seek, getTime };
}

/** 監看：播放頭所在鏡頭的首幀（沒有時用文字分鏡卡）＋運鏡示意＋旁白字幕；不是最終成片 */
function ShotMonitor({
  ratio,
  scenes,
  time,
  playing,
  onTogglePlay,
  onStep,
}: {
  ratio: Ratio;
  scenes: Scene[];
  time: number;
  playing: boolean;
  onTogglePlay: () => void;
  onStep: (delta: -1 | 1) => void;
}) {
  const { t } = useTranslation();
  const starts = shotStarts(scenes);
  const total = scenes.reduce((sum, s) => sum + s.duration_s, 0);
  const index = shotAt(starts, time);
  const scene = scenes[index];
  const local = scene ? time - (starts[index] ?? 0) : 0;
  const progress = scene && scene.duration_s > 0 ? Math.min(local / scene.duration_s, 0.999) : 0;
  const [w, h] = ratio.split(":").map(Number);
  const frameStyle = { "--vf-rw": w ?? 9, "--vf-rh": h ?? 16 } as CSSProperties;

  return (
    <section className="vf-shot-monitor" aria-label={t("shotList.monitor")}>
      <div className="vf-monitor vf-monitor-tall">
        <div className="vf-monitor-frame" style={frameStyle}>
          {scene && (
            <div key={scene.id} className="vf-shot-layer">
              {scene.first_frame_asset_id ? (
                <div
                  className={`vf-shot-motion vf-motion-${cameraMotion(scene.camera_move)}`}
                  style={{ animationDelay: `${-progress}s` }}
                >
                  <img
                    src={assetContentUrl(scene.first_frame_asset_id)}
                    alt={t("shotList.firstFrameAlt", { no: index + 1 })}
                  />
                </div>
              ) : (
                <div className="vf-shot-card">
                  <span className="vf-label">
                    {t("mono.shot", { no: shotNo(index) })} · {t("shotList.noFrame")}
                  </span>
                  <p className="vf-serif">{scene.visual_prompt}</p>
                </div>
              )}
              {scene.status === "keyframe" && (
                <div className="vf-shot-developing" role="status">
                  <span className="vf-status-spinner" aria-hidden="true" />
                  {t("sceneStatus.keyframe")}
                </div>
              )}
            </div>
          )}
          <span className="vf-monitor-third vf-monitor-third-h1" aria-hidden="true" />
          <span className="vf-monitor-third vf-monitor-third-h2" aria-hidden="true" />
          <span className="vf-monitor-third vf-monitor-third-v1" aria-hidden="true" />
          <span className="vf-monitor-third vf-monitor-third-v2" aria-hidden="true" />
          <span className="vf-corner vf-corner-tl" aria-hidden="true" />
          <span className="vf-corner vf-corner-tr" aria-hidden="true" />
          <span className="vf-corner vf-corner-bl" aria-hidden="true" />
          <span className="vf-corner vf-corner-br" aria-hidden="true" />
          {scene && (
            <>
              <span className="vf-shot-tag vf-mono">
                {t("mono.shot", { no: shotNo(index) })} · {scene.shot_type || "—"} ·{" "}
                {scene.camera_move || "—"}
              </span>
              <span className="vf-shot-local vf-mono">{timecode(local)}</span>
              {scene.narration && (
                <p className="vf-shot-subtitle" data-testid="monitor-subtitle">
                  {scene.narration}
                </p>
              )}
            </>
          )}
        </div>
        <span className="vf-monitor-safe-note vf-mono">{t("shotList.previewNote")}</span>
      </div>
      <div className="vf-transport">
        <button
          type="button"
          className="vf-icon-btn"
          aria-label={t("shotList.prev")}
          onClick={() => onStep(-1)}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M6 5h2v14H6zM20 5v14L9 12z" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className="vf-icon-btn vf-icon-btn-light"
          aria-label={playing ? t("shotList.pause") : t("shotList.play")}
          onClick={onTogglePlay}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d={playing ? "M6 5h4v14H6zM14 5h4v14h-4z" : "M7 4.5v15L19.5 12z"}
              fill="currentColor"
            />
          </svg>
        </button>
        <button
          type="button"
          className="vf-icon-btn"
          aria-label={t("shotList.next")}
          onClick={() => onStep(1)}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M16 5h2v14h-2zM4 5v14l11-7z" fill="currentColor" />
          </svg>
        </button>
        <span className="vf-transport-tc vf-mono" role="timer" aria-live="off">
          <span className="vf-transport-now">{timecode(time)}</span>
          <span className="vf-muted"> / {timecode(total)}</span>
        </span>
      </div>
    </section>
  );
}

function SaveStatus({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <span className="vf-save vf-mono" data-state={state} role="status" data-testid="save-status">
      <span className="vf-save-dot" aria-hidden="true" />
      {t(`shotList.save.${state}`)}
      {state === "error" && (
        <button type="button" className="vf-slate-reset" onClick={onRetry}>
          {t("common.retry")}
        </button>
      )}
    </span>
  );
}

interface ShotEditorProps {
  job: JobDetail;
  scene: Scene;
  count: number;
  editable: boolean;
  canPreview: boolean;
  saveState: SaveState;
  saveError: unknown;
  charsPerSecond: number | null;
  unitPrice: number | null;
  previewPending: boolean;
  previewError: unknown;
  onEdit: (sceneId: string, patch: SceneEdits) => void;
  onRetrySave: () => void;
  onPreview: (sceneId: string, force: boolean) => void;
}

/** 鏡頭編輯：修改即時反映在監看與時間軸，停止輸入後自動儲存 */
const ShotEditor = memo(function ShotEditor({
  job,
  scene,
  count,
  editable,
  canPreview,
  saveState,
  saveError,
  charsPerSecond,
  unitPrice,
  previewPending,
  previewError,
  onEdit,
  onRetrySave,
  onPreview,
}: ShotEditorProps) {
  const { t } = useTranslation();
  const index = scene.index;
  const edit = (patch: SceneEdits) => onEdit(scene.id, patch);
  const narrationCount = countChars(scene.narration);
  const narrationMax =
    charsPerSecond === null ? null : narrationLimit(scene.duration_s, charsPerSecond);
  const over = narrationMax !== null && narrationCount > narrationMax;
  const { min_s: minS, max_s: maxS } = job.shot_duration_s;
  const setDuration = (next: number) =>
    edit({ duration_s: Math.max(minS, Math.min(maxS, Math.round(next))) });
  const developing = scene.status === "keyframe";
  const price = unitPrice === null ? "" : ` · ${formatCny(unitPrice)}`;
  const sizeOptions = t("shotList.sizeOptions", { returnObjects: true }) as string[];
  const moveOptions = t("shotList.moveOptions", { returnObjects: true }) as string[];
  const visualBlank = scene.visual_prompt.trim().length === 0;
  const native = job.options.audio_mode === "native";

  return (
    <section
      className="vf-shot-editor"
      aria-labelledby="vf-shot-title"
      data-testid={`scene-editor-${index}`}
    >
      <div className="vf-shot-editor-head">
        <div>
          <span className="vf-mono vf-shot-count">
            {t("mono.shotOf", { no: shotNo(index), total: shotNo(count - 1) })}
          </span>
          <h2 id="vf-shot-title" className="vf-serif">
            {scene.shot_type || t("storyboard.sceneTitle", { index: index + 1 })}
            {scene.camera_move ? ` · ${scene.camera_move}` : ""}
          </h2>
        </div>
        {editable && <SaveStatus state={saveState} onRetry={onRetrySave} />}
      </div>
      <ErrorAlert error={saveError} />
      {/* 首幀預覽生成中時這一鏡暫停編輯（後端會拒絕修改），完成後自動恢復 */}
      <fieldset className="vf-shot-grid" disabled={!editable || developing}>
        <label className="vf-cell vf-cell-wide">
          <span className="vf-label">{t("shotList.visual")}</span>
          <textarea
            className="vf-slate-input"
            rows={3}
            value={scene.visual_prompt}
            aria-label={t("storyboard.visualPrompt")}
            aria-invalid={visualBlank}
            onChange={(e) => edit({ visual_prompt: e.target.value })}
          />
          {visualBlank && (
            <span className="vf-field-error" role="alert">
              {t("storyboard.visualRequired")}
            </span>
          )}
        </label>
        <label className="vf-cell vf-cell-wide">
          <span className="vf-shot-count-head">
            <span className="vf-label">{t("shotList.narration")}</span>
            <span
              className="vf-mono vf-narration-count"
              data-testid={`narration-count-${index}`}
              data-over={over}
            >
              {narrationMax === null
                ? t("storyboard.narrationCount", { count: narrationCount })
                : t("storyboard.narrationCountLimit", { count: narrationCount, max: narrationMax })}
              {over && ` · ${t("storyboard.narrationTooLong")}`}
            </span>
          </span>
          <textarea
            className="vf-slate-input vf-shot-narration"
            rows={2}
            value={scene.narration}
            aria-label={t("storyboard.narration")}
            onChange={(e) => edit({ narration: e.target.value })}
          />
        </label>
        <label className="vf-cell">
          <span className="vf-label">{t("shotList.speaker")}</span>
          <input
            className="vf-slate-input"
            value={scene.speaker}
            placeholder={t("storyboard.speakerPlaceholder")}
            aria-label={t("storyboard.speaker")}
            onChange={(e) => edit({ speaker: e.target.value })}
          />
        </label>
        <label className="vf-cell">
          <span className="vf-label">{t("shotList.sfx")}</span>
          <input
            className="vf-slate-input"
            value={scene.sound}
            placeholder={t("storyboard.soundPlaceholder")}
            aria-label={t("storyboard.sound")}
            onChange={(e) => edit({ sound: e.target.value })}
          />
        </label>
        <div className="vf-cell vf-cell-wide vf-shot-trio">
          <label>
            <span className="vf-label">{t("shotList.size")}</span>
            <input
              className="vf-slate-input"
              list="vf-size-options"
              value={scene.shot_type}
              aria-label={t("storyboard.shotType")}
              onChange={(e) => edit({ shot_type: e.target.value })}
            />
            <datalist id="vf-size-options">
              {sizeOptions.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </label>
          <label>
            <span className="vf-label">{t("shotList.move")}</span>
            <input
              className="vf-slate-input"
              list="vf-move-options"
              value={scene.camera_move}
              aria-label={t("storyboard.cameraMove")}
              onChange={(e) => edit({ camera_move: e.target.value })}
            />
            <datalist id="vf-move-options">
              {moveOptions.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </label>
          <div>
            <span className="vf-label" id="vf-duration-label">
              {t("shotList.duration")}
            </span>
            <fieldset className="vf-stepper" aria-labelledby="vf-duration-label">
              <button
                type="button"
                className="vf-icon-btn"
                aria-label={t("shotList.shorter")}
                disabled={scene.duration_s <= minS}
                onClick={() => setDuration(scene.duration_s - 1)}
              >
                −
              </button>
              <output className="vf-mono" aria-label={t("storyboard.duration")}>
                {formatShotSeconds(scene.duration_s)}S
              </output>
              <button
                type="button"
                className="vf-icon-btn"
                aria-label={t("shotList.longer")}
                disabled={scene.duration_s >= maxS}
                onClick={() => setDuration(scene.duration_s + 1)}
              >
                ＋
              </button>
            </fieldset>
            <span className="vf-note">{t("shotList.durationRange", { min: minS, max: maxS })}</span>
          </div>
        </div>
        <label className="vf-cell vf-cell-wide">
          <span className="vf-label">{t("shotList.screenText")}</span>
          <input
            className="vf-slate-input"
            value={scene.screen_text}
            aria-label={t("storyboard.screenText")}
            onChange={(e) => edit({ screen_text: e.target.value })}
          />
        </label>
      </fieldset>

      <div className="vf-shot-frame-row">
        <div className="vf-shot-frame-head">
          <span className="vf-label" id={`vf-needs-frame-${index}`}>
            {t("shotList.firstFrame")}
          </span>
          <Toggle
            checked={scene.needs_first_frame}
            onChange={(on) => edit({ needs_first_frame: on })}
            labelledBy={`vf-needs-frame-${index}`}
            disabled={!editable || developing}
          />
          <span className="vf-note">{t("storyboard.needsFirstFrame")}</span>
        </div>
        {scene.needs_first_frame && (
          <div className="vf-shot-frame">
            {/* 可編輯時首幀顯示在素材選擇器的小卡裡，這裡只在沒有首幀、生成中或唯讀時佔位 */}
            {(!editable || developing || !scene.first_frame_asset_id) && (
              <div className="vf-shot-thumb" data-developing={developing}>
                {scene.first_frame_asset_id ? (
                  <img
                    src={assetThumbnailUrl(scene.first_frame_asset_id)}
                    alt={t("shotList.firstFrameAlt", { no: index + 1 })}
                  />
                ) : (
                  <span className="vf-mono">{t("shotList.noFrameShort")}</span>
                )}
              </div>
            )}
            <div className="vf-shot-frame-actions">
              {developing ? (
                <span className="vf-note" role="status">
                  <span className="vf-status-spinner" aria-hidden="true" />{" "}
                  {t("sceneStatus.keyframe")}
                </span>
              ) : (
                canPreview && (
                  <button
                    type="button"
                    className="vf-btn vf-btn-ghost"
                    disabled={previewPending || saveState === "invalid"}
                    onClick={() => onPreview(scene.id, Boolean(scene.first_frame_asset_id))}
                  >
                    {scene.first_frame_asset_id
                      ? t("shotList.regenerateFrame", { price })
                      : t("shotList.previewFrame", { price })}
                  </button>
                )
              )}
              {editable && !developing && (
                <AssetPicker
                  kinds={["product", "image", "keyframe"]}
                  uploadKinds={["product", "image"]}
                  buttonText={t("storyboard.replaceFirstFrame")}
                  value={scene.first_frame_asset_id ? [scene.first_frame_asset_id] : []}
                  onChange={(ids) => edit({ first_frame_asset_id: ids[0] ?? null })}
                />
              )}
              {scene.error_message && !developing && (
                <span className="vf-field-error" role="alert">
                  {scene.error_kind ? `${t(`errorKind.${scene.error_kind}`)}：` : ""}
                  {scene.error_message}
                </span>
              )}
              <ErrorAlert error={previewError} />
            </div>
          </div>
        )}
        {native && (job.options.voice_style || job.options.music) && (
          <div className="vf-shot-voice">
            <span className="vf-label">{t("shotList.filmSound")}</span>
            <span>{[job.options.voice_style, job.options.music].filter(Boolean).join(" · ")}</span>
          </div>
        )}
      </div>
    </section>
  );
});

/** 頁頭的預估：總額、單任務預算與今日用量；超出時就地警示 */
function EstimateSummary({ estimate }: { estimate: CostEstimate | null | undefined }) {
  const { t } = useTranslation();
  if (!estimate) return null;
  return (
    <div className="vf-head-estimate">
      <span className="vf-mono vf-head-estimate-total">≈ {formatCny(estimate.total_cny)}</span>
      <span className="vf-mono vf-muted">
        {t("shotList.budgetLine", {
          budget: formatCny(estimate.budget_per_job_cny),
          spent: formatCny(estimate.spent_today_cny),
          daily: formatCny(estimate.daily_budget_cny),
        })}
      </span>
      {!estimate.within_budget ? (
        <span className="vf-field-error" role="alert">
          {t("estimate.overBudget")}
        </span>
      ) : (
        estimate.near_limit && <span className="vf-note">{t("estimate.nearLimit")}</span>
      )}
    </div>
  );
}

/** 關鍵幀單價：由預估明細裡的關鍵幀一行換算（單價只來自後端的 models.yaml） */
function keyframeUnitPrice(estimate: CostEstimate | null | undefined): number | null {
  const item = estimate?.items.find((i) => i.model_key === "keyframe" && i.quantity > 0);
  return item ? item.amount_cny / item.quantity : null;
}

/** 分鏡表（寫分鏡完成、待確認時）：監看、鏡頭編輯、時間軸、首幀預覽、確認開拍 */
export function ShotList({ job }: { job: JobDetail }) {
  const { t } = useTranslation();
  const actions = new Set(job.allowed_actions);
  const editable = actions.has("edit_storyboard");
  const canConfirm = actions.has("confirm_storyboard");
  const canPreview = actions.has("preview_keyframe");
  const meta = useMeta();
  const estimate = useEstimate(job.id, true);
  const current = estimate.data ?? job.estimate;
  const confirm = useJobCommand(job.id);
  const regenerate = useJobCommand(job.id);
  const preview = useJobCommand(job.id);
  const drafts = useShotDrafts(job, editable);
  const scenes = drafts.scenes;
  const total = scenes.reduce((sum, s) => sum + s.duration_s, 0);
  const starts = useMemo(() => shotStarts(scenes), [scenes]);
  const player = usePlayhead(total);
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, Math.max(scenes.length - 1, 0));
  const scene = scenes[index];
  const lastRejection = job.status === "rejected" ? job.reviews[0] : undefined;

  // 單價以 /meta 為準（來自 models.yaml）；舊後端沒有這個欄位時，從預估明細換算
  const unitPriceRef = useRef<number | null>(null);
  const unitPrice =
    meta.data?.keyframe_unit_cny ?? keyframeUnitPrice(current) ?? unitPriceRef.current;
  unitPriceRef.current = unitPrice;

  const { seek, setPlaying, getTime } = player;
  const select = useCallback(
    (i: number) => {
      setSelected(i);
      seek(starts[i] ?? 0);
    },
    [seek, starts],
  );
  const step = (delta: -1 | 1) => {
    const at = shotAt(starts, player.time);
    select((at + delta + scenes.length) % Math.max(scenes.length, 1));
  };

  // 修改某一鏡時停下播放，讓監看停在這一鏡，字幕即時更新
  const { edit: draftEdit, flush } = drafts;
  const onEdit = useCallback(
    (sceneId: string, patch: SceneEdits) => {
      setPlaying(false);
      const i = scenes.findIndex((s) => s.id === sceneId);
      const start = starts[i] ?? 0;
      const end = start + (scenes[i]?.duration_s ?? 0);
      const now = getTime();
      if (now < start || now >= end) seek(start);
      draftEdit(sceneId, patch);
    },
    [draftEdit, scenes, starts, getTime, seek, setPlaying],
  );

  const previewMutate = preview.mutate;
  const onPreview = useCallback(
    (sceneId: string, force: boolean) => {
      // 先存畫面描述等修改，首幀才會照最新的分鏡生成
      void flush().then((ok) => {
        if (ok) previewMutate({ type: "preview_keyframe", sceneId, force });
      });
    },
    [flush, previewMutate],
  );
  const onRetrySave = useCallback(() => void flush(), [flush]);
  const previewVars = preview.variables;
  const previewSceneId = previewVars?.type === "preview_keyframe" ? previewVars.sceneId : null;

  const missingFrames = scenes.filter(
    (s) => s.needs_first_frame && !s.first_frame_asset_id && s.status === "pending",
  );
  const previewAll = async () => {
    if (!(await flush())) return;
    for (const s of missingFrames) {
      try {
        await preview.mutateAsync({ type: "preview_keyframe", sceneId: s.id, force: false });
      } catch {
        return; // 錯誤已顯示在按鈕旁
      }
    }
  };

  const confirmShoot = async () => {
    if (await flush()) confirm.mutate({ type: "confirm_storyboard" });
  };

  const actionError = confirm.error ?? regenerate.error;
  const developing = scenes.some((s) => s.status === "keyframe");

  return (
    <div className="vf-shotlist">
      <JobHeader job={job} kicker={t("mono.shotList")}>
        <EstimateSummary estimate={current} />
        <div className="vf-head-actions">
          <TechDetails job={job} />
          {actions.has("regenerate_script") && (
            <Popconfirm
              title={t("storyboard.regenerateScriptConfirm")}
              okText={t("common.confirm")}
              cancelText={t("common.cancel")}
              onConfirm={() => regenerate.mutate({ type: "regenerate_script" })}
            >
              <button
                type="button"
                className="vf-btn vf-btn-ghost vf-btn-lg"
                disabled={regenerate.isPending || developing}
              >
                {t("shotList.rewrite")}
              </button>
            </Popconfirm>
          )}
          {canConfirm && (
            <Popconfirm
              title={t("storyboard.confirmTitle")}
              description={t("storyboard.confirmDescription", {
                amount: current ? current.total_cny.toFixed(2) : "—",
              })}
              okText={t("common.confirm")}
              cancelText={t("common.cancel")}
              onConfirm={() => void confirmShoot()}
            >
              <button
                type="button"
                className="vf-btn vf-btn-primary vf-btn-lg"
                disabled={confirm.isPending || developing}
                aria-busy={confirm.isPending}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    d="M3 10h18v10H3zM3 10l1.5-5.5 16 3.5-.6 2M8 5.3l2 4.2M13.5 6.5l2 3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinejoin="round"
                  />
                </svg>
                {t("shotList.confirm")}
              </button>
            </Popconfirm>
          )}
        </div>
      </JobHeader>

      {drafts.blocked !== null && (
        <div className="vf-callout vf-callout-error" role="alert">
          <span>{t("shotList.blocked", { no: drafts.blocked + 1 })}</span>
          <button
            type="button"
            className="vf-slate-reset"
            onClick={() => select(drafts.blocked ?? 0)}
          >
            {t("shotList.goToShot")}
          </button>
        </div>
      )}
      {(actionError || developing) && (
        <div className="vf-shotlist-notes">
          <ErrorAlert error={actionError} />
          {confirm.error instanceof ApiError &&
            confirm.error.status === 409 &&
            /預算|预算/.test(confirm.error.message) && (
              <p className="vf-field-error">{t("storyboard.overBudgetHint")}</p>
            )}
          {developing && <p className="vf-note">{t("shotList.developingHint")}</p>}
        </div>
      )}
      {lastRejection && (
        <div className="vf-callout vf-callout-warn" role="note">
          <strong>{t("storyboard.rejected", { name: lastRejection.reviewer_name })}</strong>
          {lastRejection.reason && <p>{lastRejection.reason}</p>}
        </div>
      )}
      {!editable && <p className="vf-note">{t("storyboard.readOnly")}</p>}

      <div className="vf-shot-layout vf-rise-2">
        <ShotMonitor
          ratio={job.ratio}
          scenes={scenes}
          time={player.time}
          playing={player.playing}
          onTogglePlay={() => player.setPlaying((p) => !p)}
          onStep={step}
        />
        {scene && (
          <ShotEditor
            key={scene.id}
            job={job}
            scene={scene}
            count={scenes.length}
            editable={editable}
            canPreview={canPreview}
            saveState={drafts.state}
            saveError={drafts.error}
            charsPerSecond={meta.data?.chars_per_second ?? null}
            unitPrice={unitPrice}
            previewPending={preview.isPending}
            previewError={previewSceneId === scene.id ? preview.error : null}
            onEdit={onEdit}
            onRetrySave={onRetrySave}
            onPreview={onPreview}
          />
        )}
      </div>

      <div className="vf-timeline-bar vf-rise-3">
        <span className="vf-mono vf-muted">
          {t("shotList.summary", { count: scenes.length, runtime: formatRuntime(total) })}
        </span>
        {canPreview && missingFrames.length > 0 && (
          <button
            type="button"
            className="vf-btn vf-btn-ghost"
            disabled={preview.isPending}
            onClick={() => void previewAll()}
          >
            {t("shotList.previewAll", {
              count: missingFrames.length,
              price: unitPrice === null ? "" : ` · ${formatCny(unitPrice * missingFrames.length)}`,
            })}
          </button>
        )}
      </div>
      <Timeline
        scenes={scenes}
        mode="edit"
        selected={index}
        onSelect={select}
        playhead={player.time}
      />
    </div>
  );
}
