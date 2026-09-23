import { useTranslation } from "react-i18next";
import { assetThumbnailUrl } from "../../api/client";
import type { Scene } from "../../api/types";
import { formatShotSeconds, shotNo, shotStarts } from "./shots";

/** 尺規刻度：總長越長，標字的間隔越大 */
function rulerStep(total: number): number {
  if (total <= 20) return 2;
  if (total <= 60) return 5;
  if (total <= 180) return 15;
  return 30;
}

function tickLabel(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

function clipImage(scene: Scene, mode: "edit" | "status"): string | null {
  if (mode === "status") return scene.last_frame_asset_id ?? scene.first_frame_asset_id;
  return scene.first_frame_asset_id;
}

function ClipStatus({ scene }: { scene: Scene }) {
  const { t } = useTranslation();
  switch (scene.status) {
    case "running":
    case "queued":
      return (
        <span className="vf-clip-status vf-clip-rec">
          <span className="vf-rec-dot" aria-hidden="true" />
          REC
        </span>
      );
    case "succeeded":
      return <span className="vf-clip-status vf-clip-ok">{t("sceneStatus.succeeded")}</span>;
    case "failed":
      return <span className="vf-clip-status vf-clip-failed">{t("sceneStatus.failed")}</span>;
    case "keyframe":
      return (
        <span className="vf-clip-status">
          <span className="vf-status-spinner" aria-hidden="true" />
          {t("sceneStatus.keyframe")}
        </span>
      );
    default:
      return null;
  }
}

/**
 * 剪輯時間軸：V1 畫面（按時長等比）、A1 說話者與音效（分鏡階段沒有實際音訊，不畫波形）、T1 字幕、紅色播放頭。
 * edit：點選即編輯該鏡；status：顯示各鏡狀態與失敗原因。
 */
export function Timeline({
  scenes,
  mode,
  selected,
  onSelect,
  playhead,
}: {
  scenes: Scene[];
  mode: "edit" | "status";
  selected?: number;
  onSelect?: (index: number) => void;
  playhead?: number;
}) {
  const { t } = useTranslation();
  const total = scenes.reduce((sum, s) => sum + s.duration_s, 0);
  const starts = shotStarts(scenes);
  const step = rulerStep(total);
  const ticks: number[] = [];
  for (let s = 0; s <= total; s += 1) ticks.push(s);
  const pct = (seconds: number) => (total > 0 ? (seconds / total) * 100 : 0);
  const failures = scenes.filter((s) => s.status === "failed" && s.error_message);

  return (
    <section className="vf-timeline" aria-label={t("shotList.timeline")}>
      <div className="vf-track vf-track-ruler" aria-hidden="true">
        <span className="vf-track-head vf-mono">TIMELINE</span>
        <div className="vf-track-body">
          {ticks.map((s) => (
            <span
              key={s}
              className={s % step === 0 ? "vf-tick vf-tick-major" : "vf-tick"}
              style={{ left: `${pct(s)}%` }}
            >
              {s % step === 0 && <span className="vf-mono">{tickLabel(s)}</span>}
            </span>
          ))}
        </div>
      </div>
      <div className="vf-tracks">
        <div className="vf-track vf-track-video">
          <span className="vf-track-head vf-mono">{t("shotList.trackVideo")}</span>
          <div className="vf-track-body vf-track-clips">
            {scenes.map((scene, i) => {
              const image = clipImage(scene, mode);
              return (
                <button
                  key={scene.id}
                  type="button"
                  className="vf-clip"
                  style={{ flexGrow: scene.duration_s }}
                  aria-pressed={mode === "edit" ? selected === i : undefined}
                  aria-label={t("shotList.clipLabel", {
                    no: i + 1,
                    seconds: formatShotSeconds(scene.duration_s),
                  })}
                  data-status={scene.status}
                  data-testid={`clip-${i}`}
                  onClick={() => onSelect?.(i)}
                >
                  {image ? (
                    <img src={assetThumbnailUrl(image)} alt="" loading="lazy" />
                  ) : (
                    <span className="vf-clip-text">{scene.visual_prompt}</span>
                  )}
                  <span className="vf-clip-label vf-mono">
                    {shotNo(i)} · {formatShotSeconds(scene.duration_s)}S
                  </span>
                  <ClipStatus scene={scene} />
                </button>
              );
            })}
          </div>
        </div>
        <div className="vf-track vf-track-audio">
          <span className="vf-track-head vf-mono">{t("shotList.trackAudio")}</span>
          <div className="vf-track-body vf-track-blocks">
            {scenes.map((scene) => (
              <span key={scene.id} className="vf-block" style={{ flexGrow: scene.duration_s }}>
                {scene.speaker && <span className="vf-block-speaker">{scene.speaker}</span>}
                <span className="vf-block-text">{scene.sound || (scene.speaker ? "" : "—")}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="vf-track vf-track-subs">
          <span className="vf-track-head vf-mono">{t("shotList.trackSubs")}</span>
          <div className="vf-track-body vf-track-blocks">
            {scenes.map((scene) => (
              <span key={scene.id} className="vf-block" style={{ flexGrow: scene.duration_s }}>
                <span className="vf-block-text">{scene.narration || "—"}</span>
              </span>
            ))}
          </div>
        </div>
        {playhead !== undefined && total > 0 && (
          <div className="vf-playhead-lane" aria-hidden="true">
            <span className="vf-playhead" style={{ left: `${pct(Math.min(playhead, total))}%` }} />
          </div>
        )}
      </div>
      {mode === "status" && failures.length > 0 && (
        <ul className="vf-timeline-failures">
          {failures.map((scene) => (
            <li key={scene.id}>
              <span className="vf-mono">SHOT {shotNo(scene.index)}</span>
              {scene.error_kind ? `${t(`errorKind.${scene.error_kind}`)}：` : ""}
              {scene.error_message}
            </li>
          ))}
        </ul>
      )}
      {starts.length === 0 && <p className="vf-note">{t("scene.empty")}</p>}
    </section>
  );
}
