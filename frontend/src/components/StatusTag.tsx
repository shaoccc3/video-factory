import { Tag } from "antd";
import { useTranslation } from "react-i18next";
import type { JobStatus, SceneStatus } from "../api/types";

export const JOB_STATUS_COLORS: Record<JobStatus, string> = {
  draft: "default",
  scripting: "processing",
  storyboard_ready: "gold",
  generating: "processing",
  composing: "processing",
  in_review: "purple",
  approved: "success",
  rejected: "orange",
  failed: "error",
  cancelled: "default",
  budget_exceeded: "magenta",
};

const SCENE_STATUS_COLORS: Record<SceneStatus, string> = {
  pending: "default",
  keyframe: "cyan",
  queued: "blue",
  running: "processing",
  succeeded: "success",
  failed: "error",
  cancelled: "default",
};

export function JobStatusTag({ status }: { status: JobStatus }) {
  const { t } = useTranslation();
  return <Tag color={JOB_STATUS_COLORS[status]}>{t(`jobStatus.${status}`)}</Tag>;
}

export function SceneStatusTag({ status }: { status: SceneStatus }) {
  const { t } = useTranslation();
  return <Tag color={SCENE_STATUS_COLORS[status]}>{t(`sceneStatus.${status}`)}</Tag>;
}
