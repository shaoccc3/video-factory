import { Input, Pagination, Progress, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { assetThumbnailUrl } from "../api/client";
import { useJobs } from "../api/hooks";
import {
  JOB_STATUSES,
  type JobStatus,
  type JobSummary,
  VIDEO_TYPES,
  type VideoType,
} from "../api/types";
import { ErrorAlert } from "../components/ErrorResult";
import { formatRuntime } from "../components/job/JobHeader";
import { JobStatusTag } from "../components/StatusTag";
import { PosterFallback } from "../components/studio/PosterFallback";
import { Toggle } from "../components/studio/Toggle";
import { formatCny, formatDateTime, percent } from "../utils/format";
import "./jobs.css";

function pick<T extends string>(values: readonly T[], value: string | null): T | undefined {
  return (values as readonly string[]).includes(value ?? "") ? (value as T) : undefined;
}

export function JobProgressBar({ job }: { job: JobSummary }) {
  if (job.progress.total === 0) return <Typography.Text type="secondary">—</Typography.Text>;
  return (
    <Progress
      size="small"
      style={{ minWidth: 100, margin: 0 }}
      percent={percent(job.progress.succeeded + job.progress.failed, job.progress.total)}
      success={{ percent: percent(job.progress.succeeded, job.progress.total) }}
      status={job.progress.failed > 0 ? "exception" : "normal"}
      format={() => `${job.progress.succeeded}/${job.progress.total}`}
    />
  );
}

/** 狀態頁籤：多個狀態一組（v1.3 的 GET /jobs 可帶多個 status） */
const STATUS_TABS: Record<string, readonly JobStatus[] | undefined> = {
  all: undefined,
  active: ["scripting", "storyboard_ready", "generating", "composing"],
  review: ["in_review"],
  approved: ["approved"],
  attention: ["failed", "budget_exceeded", "rejected"],
  draft: ["draft"],
  cancelled: ["cancelled"],
};
const TAB_KEYS = Object.keys(STATUS_TABS);
const SKELETON_ROWS = ["a", "b", "c", "d", "e"];

/** 分鏡進度：成功／總數，失敗時轉紅 */
function ShotProgress({ job }: { job: JobSummary }) {
  const { total, succeeded, failed } = job.progress;
  if (total === 0) return <span className="vf-muted">—</span>;
  return (
    <span className="vf-jobs-progress" data-failed={failed > 0}>
      <span className="vf-jobs-progress-bar" aria-hidden="true">
        <span style={{ width: `${percent(succeeded, total)}%` }} />
      </span>
      <span className="vf-mono">
        {succeeded}/{total}
      </span>
    </span>
  );
}

function Still({ job }: { job: JobSummary }) {
  const portrait = job.ratio === "9:16" || job.ratio === "3:4";
  return (
    <span className="vf-jobs-still" data-portrait={portrait}>
      {job.preview_asset_id ? (
        <img src={assetThumbnailUrl(job.preview_asset_id)} alt="" loading="lazy" />
      ) : (
        <PosterFallback title={job.title} size="sm" />
      )}
    </span>
  );
}

/** 全部任務：一列一支片，頁籤篩選狀態，保留搜尋、只看我的與分頁 */
export function JobsPage() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const single = pick<JobStatus>(JOB_STATUSES, params.get("status"));
  const tab = TAB_KEYS.includes(params.get("tab") ?? "") ? (params.get("tab") as string) : "all";
  const videoType = pick<VideoType>(VIDEO_TYPES, params.get("video_type"));
  const mine = params.get("mine") === "1";
  const q = params.get("q") ?? "";
  const page = Number(params.get("page") ?? "1") || 1;
  const pageSize = Number(params.get("page_size") ?? "20") || 20;
  const group = STATUS_TABS[tab];
  const statuses: JobStatus[] | undefined = single ? [single] : group ? [...group] : undefined;

  const jobs = useJobs({
    status: statuses,
    video_type: videoType,
    mine: mine || undefined,
    q: q || undefined,
    sort: "updated",
    page,
    page_size: pageSize,
  });

  const update = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in changes)) next.delete("page");
    setParams(next, { replace: true });
  };

  const items = jobs.data?.items ?? [];

  return (
    <div className="vf-jobs">
      <header className="vf-jobs-head vf-rise">
        <div>
          <span className="vf-label">
            {t("mono.allProductions")}
            {jobs.data ? ` · ${jobs.data.total}` : ""}
          </span>
          <h1 className="vf-serif">{t("jobs.title")}</h1>
        </div>
      </header>

      <div className="vf-jobs-filters vf-rise-2">
        <fieldset className="vf-tabs vf-jobs-tabs" aria-label={t("jobs.columns.status")}>
          {TAB_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className="vf-tab"
              aria-pressed={!single && tab === key}
              onClick={() => update({ tab: key === "all" ? undefined : key, status: undefined })}
            >
              {t(`jobs.tabs.${key}`)}
            </button>
          ))}
        </fieldset>
        <div className="vf-jobs-tools">
          <fieldset className="vf-tabs vf-jobs-types" aria-label={t("jobs.columns.type")}>
            <button
              type="button"
              className="vf-tab"
              aria-pressed={!videoType}
              onClick={() => update({ video_type: undefined })}
            >
              {t("jobs.filterType")}
            </button>
            {VIDEO_TYPES.map((v) => (
              <button
                key={v}
                type="button"
                className="vf-tab"
                aria-pressed={videoType === v}
                onClick={() => update({ video_type: v })}
              >
                {t(`videoType.${v}`)}
              </button>
            ))}
          </fieldset>
          <Input.Search
            allowClear
            className="vf-jobs-search"
            placeholder={t("jobs.search")}
            aria-label={t("jobs.search")}
            defaultValue={q}
            onSearch={(text) => update({ q: text })}
          />
          <span className="vf-jobs-mine">
            <Toggle
              checked={mine}
              onChange={(on) => update({ mine: on ? "1" : undefined })}
              label={t("jobs.mine")}
            />
            <span aria-hidden="true">{t("jobs.mine")}</span>
          </span>
        </div>
        {single && (
          <p className="vf-jobs-chip">
            {t("jobs.columns.status")}：{t(`jobStatus.${single}`)}
            <button
              type="button"
              className="vf-slate-reset"
              onClick={() => update({ status: undefined })}
            >
              {t("jobs.clearStatus")}
            </button>
          </p>
        )}
      </div>

      <ErrorAlert error={jobs.error} />

      <div className="vf-jobs-table-wrap vf-rise-3">
        <table className="vf-jobs-table" aria-busy={jobs.isFetching}>
          <thead>
            <tr>
              <th scope="col">
                <span className="vf-sr-only">{t("jobs.columns.still")}</span>
              </th>
              <th scope="col">{t("jobs.columns.title")}</th>
              <th scope="col">{t("jobs.columns.status")}</th>
              <th scope="col">{t("jobs.columns.type")}</th>
              <th scope="col">{t("jobs.columns.ratio")}</th>
              <th scope="col">{t("jobs.columns.runtime")}</th>
              <th scope="col" className="vf-num">
                {t("jobs.columns.cost")}
              </th>
              <th scope="col">{t("jobs.columns.updatedAt")}</th>
            </tr>
          </thead>
          <tbody>
            {jobs.isPending
              ? SKELETON_ROWS.map((key) => (
                  <tr key={key}>
                    <td colSpan={8}>
                      <span className="vf-skel vf-skel-row" aria-hidden="true" />
                    </td>
                  </tr>
                ))
              : items.map((job) => (
                  <tr key={job.id} className="vf-jobs-row">
                    <td>
                      <Still job={job} />
                    </td>
                    <td>
                      <div className="vf-jobs-title">
                        <Link to={`/jobs/${job.id}`} className="vf-stretched">
                          {job.title}
                        </Link>
                        <span className="vf-muted">
                          {job.template_name} · {job.owner_name}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="vf-jobs-status">
                        <JobStatusTag status={job.status} />
                        <ShotProgress job={job} />
                      </span>
                    </td>
                    <td className="vf-mono">{t(`videoType.${job.video_type}`)}</td>
                    <td className="vf-mono">{job.ratio}</td>
                    <td className="vf-mono">
                      {job.runtime_s === null ? "—" : formatRuntime(job.runtime_s)}
                    </td>
                    <td className="vf-mono vf-num">
                      {formatCny(job.actual_cost_cny)}
                      <span className="vf-muted"> / {formatCny(job.estimated_cost_cny)}</span>
                    </td>
                    <td className="vf-mono vf-muted">
                      {formatDateTime(job.updated_at, i18n.language)}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
        {!jobs.isPending && items.length === 0 && (
          <div className="vf-jobs-empty">
            <p>{t("jobs.empty")}</p>
            <Link to="/jobs/new" className="vf-link">
              {t("jobs.newLink")}
            </Link>
          </div>
        )}
      </div>

      <Pagination
        className="vf-jobs-pager"
        current={page}
        pageSize={pageSize}
        total={jobs.data?.total ?? 0}
        showSizeChanger
        hideOnSinglePage
        onChange={(p, size) => update({ page: String(p), page_size: String(size) })}
      />
    </div>
  );
}
