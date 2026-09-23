import { Popconfirm } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { type JobCommand, useJob, useJobCommand } from "../api/hooks";
import { useJobEvents } from "../api/sse";
import type { JobDetail } from "../api/types";
import { ErrorAlert, ErrorResult } from "../components/ErrorResult";
import { JobErrorAlert } from "../components/job/JobErrorAlert";
import { JobHeader, TechDetails } from "../components/job/JobHeader";
import { FinalPreview, ReviewHistory, ScenePreviews } from "../components/job/JobPanels";
import { ShotList } from "../components/job/ShotList";
import { Timeline } from "../components/job/Timeline";
import { formatCny, formatDateTime } from "../utils/format";
import "../components/job/shotlist.css";

const STORYBOARD_STATUSES = new Set(["storyboard_ready", "rejected"]);
/** 寫分鏡中的時間軸骨架：四段不等長的灰塊 */
const SKELETON_CLIPS = [
  ["a", 5],
  ["b", 3],
  ["c", 4],
  ["d", 6],
] as const;

/** 狀態類操作（依 allowed_actions）；分鏡表另有自己的確認開拍與重寫分鏡 */
function JobActions({ job }: { job: JobDetail }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const command = useJobCommand(job.id);
  const actions = new Set(job.allowed_actions);
  const inStoryboard = STORYBOARD_STATUSES.has(job.status);
  const run = (c: JobCommand) => command.mutate(c);
  const pending = command.isPending ? command.variables?.type : undefined;

  return (
    <div className="vf-head-actions-wrap">
      <div className="vf-head-actions">
        <TechDetails job={job} />
        {actions.has("regenerate_script") && !inStoryboard && (
          <button
            type="button"
            className="vf-btn vf-btn-ghost vf-btn-lg"
            disabled={pending === "regenerate_script"}
            onClick={() => run({ type: "regenerate_script" })}
          >
            {t("storyboard.regenerateScript")}
          </button>
        )}
        {actions.has("cancel") && (
          <Popconfirm
            title={t("actions.cancelConfirm")}
            okText={t("common.confirm")}
            cancelText={t("common.cancel")}
            onConfirm={() => run({ type: "cancel" })}
          >
            <button
              type="button"
              className="vf-btn vf-btn-ghost vf-btn-lg vf-btn-danger"
              disabled={pending === "cancel"}
            >
              {t("actions.cancel")}
            </button>
          </Popconfirm>
        )}
        {actions.has("resume") && (
          <button
            type="button"
            className="vf-btn vf-btn-outline vf-btn-lg"
            disabled={pending === "resume"}
            onClick={() => run({ type: "resume" })}
          >
            {t("actions.resume")}
          </button>
        )}
        {actions.has("review") && (
          <button
            type="button"
            className="vf-btn vf-btn-outline vf-btn-lg"
            onClick={() => void navigate(`/reviews/${job.id}`)}
          >
            {t("actions.review")}
          </button>
        )}
        {actions.has("render_final") && (
          <Popconfirm
            title={t("actions.renderFinalConfirm")}
            okText={t("common.confirm")}
            cancelText={t("common.cancel")}
            onConfirm={() => run({ type: "render_final" })}
          >
            <button
              type="button"
              className="vf-btn vf-btn-primary vf-btn-lg"
              disabled={pending === "render_final"}
            >
              {t("actions.renderFinal")}
            </button>
          </Popconfirm>
        )}
        {actions.has("submit") && (
          <button
            type="button"
            className="vf-btn vf-btn-primary vf-btn-lg"
            disabled={pending === "submit"}
            onClick={() => run({ type: "submit" })}
          >
            {t("actions.submit")}
          </button>
        )}
      </div>
      <ErrorAlert error={command.error} />
    </div>
  );
}

/** 內容檢查警告與任務錯誤 */
function JobNotices({ job }: { job: JobDetail }) {
  const { t } = useTranslation();
  return (
    <>
      {job.warnings.length > 0 && (
        <div className="vf-callout vf-callout-warn" role="note">
          <strong>{t("jobDetail.warnings")}</strong>
          <ul>
            {job.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <JobErrorAlert job={job} />
    </>
  );
}

/** 片子的基本資料：想法、聲音、擁有者、費用 */
function JobFacts({ job }: { job: JobDetail }) {
  const { t, i18n } = useTranslation();
  const native = job.options.audio_mode === "native";
  const rows: [string, string][] = [
    [t("wizard.fields.topic"), job.inputs.topic],
    ...(job.inputs.extra ? [[t("wizard.fields.extra"), job.inputs.extra] as [string, string]] : []),
    [t("wizard.fields.audioMode"), t(`audioMode.${job.options.audio_mode}`)],
    ...(native
      ? ([
          [t("wizard.fields.voiceStyle"), job.options.voice_style || "—"],
          [t("wizard.fields.music"), job.options.music || "—"],
          [
            t("wizard.fields.consistentVoice"),
            job.options.consistent_voice ? t("common.yes") : t("common.no"),
          ],
        ] as [string, string][])
      : []),
    [t("jobs.columns.template"), job.template_name],
    [t("jobs.columns.owner"), job.owner_name],
    [t("jobs.columns.createdAt"), formatDateTime(job.created_at, i18n.language)],
    [
      t("jobDetail.cost"),
      `${formatCny(job.actual_cost_cny)} / ${formatCny(job.estimated_cost_cny)}`,
    ],
  ];
  return (
    <section className="vf-facts" aria-label={t("shotList.facts")}>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="vf-label">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** 寫分鏡中：同一版面顯示骨架，完成後由 SSE 換成分鏡表 */
function WritingView({ job }: { job: JobDetail }) {
  const { t } = useTranslation();
  return (
    <div className="vf-shotlist">
      <JobHeader job={job} kicker="SHOT LIST">
        <JobActions job={job} />
      </JobHeader>
      <div className="vf-shot-layout vf-rise-2" aria-busy="true">
        <section className="vf-shot-monitor">
          <div className="vf-monitor vf-monitor-tall vf-writing">
            <span className="vf-writing-scan" aria-hidden="true" />
            <div className="vf-writing-card" role="status">
              <span className="vf-label">WRITING · SHOT LIST</span>
              <p className="vf-serif">{t("jobDetail.scripting")}</p>
            </div>
          </div>
        </section>
        <section className="vf-shot-editor vf-skeleton" aria-hidden="true">
          <span className="vf-skel vf-skel-title" />
          <span className="vf-skel vf-skel-block" />
          <span className="vf-skel vf-skel-block" />
          <span className="vf-skel vf-skel-row" />
          <span className="vf-skel vf-skel-row" />
        </section>
      </div>
      <div className="vf-timeline vf-skeleton" aria-hidden="true">
        {SKELETON_CLIPS.map(([key, grow]) => (
          <span key={key} className="vf-skel vf-skel-clip" style={{ flexGrow: grow }} />
        ))}
      </div>
      <JobFacts job={job} />
    </div>
  );
}

/** 其他狀態：新頁頭、時間軸顯示各鏡狀態，成片與審核面板沿用 */
function ProductionView({ job }: { job: JobDetail }) {
  const { t } = useTranslation();
  const focusScene = (index: number) =>
    document
      .getElementById(`scene-${index}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  return (
    <div className="vf-shotlist">
      <JobHeader job={job} kicker="PRODUCTION">
        <JobActions job={job} />
      </JobHeader>
      <JobNotices job={job} />
      {job.status === "draft" && job.scenes.length === 0 && (
        <p className="vf-note">{t("jobDetail.draftHint")}</p>
      )}
      <FinalPreview job={job} />
      {job.scenes.length > 0 && (
        <>
          <Timeline scenes={job.scenes} mode="status" onSelect={focusScene} />
          <ScenePreviews job={job} />
        </>
      )}
      <ReviewHistory reviews={job.reviews} />
      <JobFacts job={job} />
    </div>
  );
}

export function JobDetailPage() {
  const { id } = useParams();
  const job = useJob(id);
  useJobEvents(id);

  if (job.isPending) {
    return (
      <div className="vf-shotlist" aria-busy="true">
        <span className="vf-skel vf-skel-heading" />
        <span className="vf-skel vf-skel-block" />
      </div>
    );
  }
  if (job.isError) {
    return <ErrorResult error={job.error} onRetry={() => void job.refetch()} />;
  }

  const data = job.data;
  if (STORYBOARD_STATUSES.has(data.status) && data.scenes.length > 0) {
    return (
      <>
        <ShotList job={data} />
        <div className="vf-shotlist vf-shotlist-tail">
          <JobNotices job={data} />
          <ReviewHistory reviews={data.reviews} />
          <JobFacts job={data} />
        </div>
      </>
    );
  }
  if (data.status === "scripting") return <WritingView job={data} />;
  return <ProductionView job={data} />;
}
