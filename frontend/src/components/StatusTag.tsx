import { useTranslation } from "react-i18next";
import type { JobStatus, SceneStatus } from "../api/types";
import "./status.css";

type Tone = "accent" | "rec" | "mix" | "info" | "ok" | "warn" | "muted" | "live";

const JOB_TONES: Record<JobStatus, Tone> = {
  draft: "muted",
  scripting: "live",
  storyboard_ready: "accent",
  generating: "rec",
  composing: "mix",
  in_review: "info",
  approved: "ok",
  rejected: "warn",
  failed: "warn",
  cancelled: "muted",
  budget_exceeded: "warn",
};

const SCENE_TONES: Record<SceneStatus, Tone> = {
  pending: "muted",
  keyframe: "live",
  queued: "muted",
  running: "rec",
  succeeded: "ok",
  failed: "warn",
  cancelled: "muted",
};

function Marker({ tone }: { tone: Tone }) {
  if (tone === "rec") return <span className="vf-rec-dot" aria-hidden="true" />;
  if (tone === "live") return <span className="vf-status-spinner" aria-hidden="true" />;
  if (tone === "mix") {
    return (
      <span className="vf-status-bars" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </span>
    );
  }
  return null;
}

/** 狀態標籤（剪輯台樣式）：生成中有錄製紅點、合成中有音量條 */
export function StatusSlate({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className={`vf-status vf-status-${tone}`}>
      <Marker tone={tone} />
      {label}
    </span>
  );
}

export function JobStatusTag({ status }: { status: JobStatus }) {
  const { t } = useTranslation();
  return <StatusSlate tone={JOB_TONES[status]} label={t(`jobStatus.${status}`)} />;
}

export function SceneStatusTag({ status }: { status: SceneStatus }) {
  const { t } = useTranslation();
  return <StatusSlate tone={SCENE_TONES[status]} label={t(`sceneStatus.${status}`)} />;
}
