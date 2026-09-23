import { Input, Modal, Pagination } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { assetContentUrl, assetDownloadUrl, assetThumbnailUrl } from "../api/client";
import { useJob, useJobs } from "../api/hooks";
import { type JobSummary, type Ratio, VIDEO_TYPES, type VideoType } from "../api/types";
import { ErrorAlert } from "../components/ErrorResult";
import { formatRuntime } from "../components/job/JobHeader";
import { JobStatusTag } from "../components/StatusTag";
import { PosterFallback } from "../components/studio/PosterFallback";
import "./library.css";

type LibraryStatus = "approved" | "in_review";
const PAGE_SIZE = 24;
/** 藝廊的列高（px）：每張片按畫幅換算成寬度，同一列等高 */
const ROW_HEIGHT = 240;

function ratioValue(ratio: Ratio | string): number {
  const [w, h] = ratio.split(":").map(Number);
  return w && h ? w / h : 16 / 9;
}

function filmDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

/** 片子的等寬規格：類型 · 畫幅 · 片長 · 日期 */
function useFilmSpec() {
  const { t } = useTranslation();
  return (job: JobSummary) =>
    [
      t(`videoType.${job.video_type}`),
      job.ratio,
      ...(job.runtime_s ? [formatRuntime(job.runtime_s)] : []),
      filmDate(job.updated_at),
    ].join(" · ");
}

function FilmCard({ job, onPlay }: { job: JobSummary; onPlay: () => void }) {
  const { t } = useTranslation();
  const spec = useFilmSpec();
  const r = ratioValue(job.ratio);
  const still = job.cover_asset_id ?? job.preview_asset_id;
  return (
    <article
      className="vf-film"
      style={{ flexGrow: r, flexBasis: `${Math.round(r * ROW_HEIGHT)}px` }}
      aria-labelledby={`vf-film-${job.id}`}
    >
      <button
        type="button"
        className="vf-film-still vf-zoom"
        style={{ aspectRatio: `${r}` }}
        onClick={onPlay}
        aria-label={t("library.playFilm", { title: job.title })}
      >
        {still ? (
          <img src={assetThumbnailUrl(still)} alt="" loading="lazy" />
        ) : (
          <PosterFallback title={job.title} kicker={job.ratio} size="sm" />
        )}
        <span className="vf-film-play vf-reveal" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M7 4.5v15L19.5 12z" fill="currentColor" />
          </svg>
        </span>
      </button>
      <div className="vf-film-caption">
        <h2 id={`vf-film-${job.id}`} className="vf-serif">
          {job.title}
        </h2>
        <span className="vf-mono vf-muted">{spec(job)}</span>
        <span className="vf-film-actions">
          {job.status === "approved" && job.final_asset_id ? (
            <a className="vf-link" href={assetDownloadUrl(job.final_asset_id)}>
              {t("final.download")}
            </a>
          ) : (
            <JobStatusTag status={job.status} />
          )}
        </span>
      </div>
    </article>
  );
}

/** 放映燈箱：深色遮罩、上下黑邊、播放器、片名與規格；已通過的片可下載 */
function ScreeningLightbox({
  playId,
  fromList,
  onClose,
}: {
  playId: string | null;
  fromList: JobSummary | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const spec = useFilmSpec();
  // 網址帶的片不在目前這一頁時，單獨讀取
  const fetched = useJob(playId && !fromList ? playId : undefined);
  const job: JobSummary | undefined = fromList ?? fetched.data;
  const open = playId !== null;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      width="min(1120px, 94vw)"
      rootClassName="vf-lightbox"
      // 燈箱自己淡入（library.css），關閉時像關掉放映機一樣立即熄滅
      transitionName=""
      maskTransitionName=""
      title={<span className="vf-sr-only">{job?.title ?? t("nav.library")}</span>}
      closable
      destroyOnHidden
    >
      {fetched.isError && !fromList ? (
        <ErrorAlert error={fetched.error} />
      ) : !job ? (
        <span className="vf-skel vf-skel-block" aria-busy="true" />
      ) : (
        <div className="vf-lightbox-body">
          <div className="vf-lightbox-stage">
            {job.final_asset_id ? (
              // 自動播放被瀏覽器擋下時（例如直接打開 ?play= 連結）保留播放器讓使用者自己按
              // biome-ignore lint/a11y/useMediaCaption: 成片字幕已燒錄進畫面
              <video
                key={job.id}
                data-testid="lightbox-video"
                src={assetContentUrl(job.final_asset_id)}
                poster={job.cover_asset_id ? assetContentUrl(job.cover_asset_id) : undefined}
                controls
                autoPlay
                playsInline
              />
            ) : (
              <p className="vf-note">{t("library.noFinal")}</p>
            )}
          </div>
          <div className="vf-lightbox-meta">
            <div>
              <span className="vf-label">{t("mono.nowScreening")}</span>
              <h2 className="vf-serif">{job.title}</h2>
              <span className="vf-mono vf-muted">{spec(job)}</span>
            </div>
            <div className="vf-lightbox-actions">
              <Link to={`/jobs/${job.id}`} className="vf-btn vf-btn-ghost">
                {t("library.detail")}
              </Link>
              {job.status === "approved" && job.final_asset_id ? (
                <a className="vf-btn vf-btn-primary" href={assetDownloadUrl(job.final_asset_id)}>
                  {t("final.download")}
                </a>
              ) : (
                <span className="vf-note">{t("final.downloadLocked")}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** 放映室：成片藝廊（直式橫式按比例混排）＋放映燈箱；支援 ?play=<id> 直接開片 */
export function LibraryPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<LibraryStatus>("approved");
  const [videoType, setVideoType] = useState<VideoType | undefined>();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const playId = params.get("play");
  const jobs = useJobs({
    status,
    video_type: videoType,
    q: q || undefined,
    page,
    page_size: PAGE_SIZE,
  });
  const items = (jobs.data?.items ?? []).filter((job) => job.final_asset_id !== null);

  const setPlay = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("play", id);
    else next.delete("play");
    setParams(next);
  };

  return (
    <div className="vf-library">
      <header className="vf-library-head vf-rise">
        <span className="vf-label">
          {t("mono.screeningRoom")}
          {jobs.data ? ` · ${jobs.data.total}` : ""}
        </span>
        <h1 className="vf-serif">{t("nav.library")}</h1>
      </header>
      <div className="vf-library-filters vf-rise-2">
        <fieldset className="vf-tabs vf-underline-tabs" aria-label={t("jobs.columns.status")}>
          {(["approved", "in_review"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className="vf-tab"
              aria-pressed={status === s}
              onClick={() => {
                setStatus(s);
                setPage(1);
              }}
            >
              {t(`jobStatus.${s}`)}
            </button>
          ))}
        </fieldset>
        <div className="vf-library-tools">
          <fieldset className="vf-tabs" aria-label={t("jobs.columns.type")}>
            <button
              type="button"
              className="vf-tab"
              aria-pressed={!videoType}
              onClick={() => {
                setVideoType(undefined);
                setPage(1);
              }}
            >
              {t("jobs.filterType")}
            </button>
            {VIDEO_TYPES.map((v) => (
              <button
                key={v}
                type="button"
                className="vf-tab"
                aria-pressed={videoType === v}
                onClick={() => {
                  setVideoType(v);
                  setPage(1);
                }}
              >
                {t(`videoType.${v}`)}
              </button>
            ))}
          </fieldset>
          <Input.Search
            allowClear
            className="vf-library-search"
            aria-label={t("jobs.search")}
            placeholder={t("jobs.search")}
            onSearch={(text) => {
              setQ(text);
              setPage(1);
            }}
          />
        </div>
      </div>
      <ErrorAlert error={jobs.error} />
      {jobs.isPending ? (
        <div className="vf-gallery" aria-busy="true">
          {["a", "b", "c", "d"].map((key) => (
            <span key={key} className="vf-skel vf-gallery-skel" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="vf-library-empty">
          <p className="vf-serif">{t("library.empty")}</p>
          <Link to="/jobs/new" className="vf-link">
            {t("jobs.newLink")}
          </Link>
        </div>
      ) : (
        <div className="vf-gallery vf-rise-3">
          {items.map((job) => (
            <FilmCard key={job.id} job={job} onPlay={() => setPlay(job.id)} />
          ))}
          <span className="vf-gallery-filler" aria-hidden="true" />
        </div>
      )}
      <Pagination
        className="vf-library-pager"
        current={page}
        pageSize={PAGE_SIZE}
        total={jobs.data?.total ?? 0}
        onChange={setPage}
        showSizeChanger={false}
        hideOnSinglePage
      />
      <ScreeningLightbox
        playId={playId}
        fromList={items.find((job) => job.id === playId)}
        onClose={() => setPlay(null)}
      />
    </div>
  );
}
