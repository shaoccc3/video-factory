import { App as AntdApp } from "antd";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { assetContentUrl, assetThumbnailUrl } from "../api/client";
import { useJob, useReviewQueue } from "../api/hooks";
import type { JobDetail, JobSummary } from "../api/types";
import { ErrorAlert, ErrorResult } from "../components/ErrorResult";
import { formatRuntime, jobCode } from "../components/job/JobHeader";
import { ReviewHistory } from "../components/job/JobPanels";
import { ReviewForm } from "../components/ReviewForm";
import { JobStatusTag } from "../components/StatusTag";
import { PosterFallback } from "../components/studio/PosterFallback";
import { useNow } from "../hooks/motion";
import { formatCny, formatDateTime } from "../utils/format";
import "./reviews.css";

/** 等了多久：2H 15M、3D 4H（單位字樣放在 i18n） */
function waited(since: string, now: Date, t: TFunction): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 60000));
  if (minutes < 60) return t("mono.waitedM", { m: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("mono.waitedH", { h: hours, m: minutes % 60 });
  return t("mono.waitedD", { d: Math.floor(hours / 24), h: hours % 24 });
}

function QueueCard({ job, now }: { job: JobSummary; now: Date }) {
  const { t, i18n } = useTranslation();
  const still = job.cover_asset_id ?? job.preview_asset_id;
  return (
    <article className="vf-queue-card vf-zoom">
      <div className="vf-queue-still">
        {still ? (
          <img src={assetThumbnailUrl(still)} alt="" loading="lazy" />
        ) : (
          <PosterFallback title={job.title} kicker={job.ratio} size="sm" />
        )}
        <span className="vf-queue-wait vf-mono">
          {t("review.waited", { time: waited(job.updated_at, now, t) })}
        </span>
      </div>
      <div className="vf-queue-body">
        <h2 className="vf-serif">
          <Link to={`/reviews/${job.id}`} className="vf-stretched">
            {job.title}
          </Link>
        </h2>
        <span className="vf-mono vf-muted">
          {[
            t(`videoType.${job.video_type}`),
            job.ratio,
            ...(job.runtime_s ? [formatRuntime(job.runtime_s)] : []),
            formatCny(job.actual_cost_cny),
          ].join(" · ")}
        </span>
        <span className="vf-muted vf-queue-owner">
          {job.owner_name} · {t("review.submittedAt")}{" "}
          {formatDateTime(job.updated_at, i18n.language)}
        </span>
      </div>
    </article>
  );
}

/** 待審清單：片卡，最早送審的排最前 */
export function ReviewsPage() {
  const { t } = useTranslation();
  const queue = useReviewQueue();
  const now = useNow(60_000);
  const items = [...(queue.data ?? [])].sort(
    (a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime(),
  );
  return (
    <div className="vf-reviews">
      <header className="vf-reviews-head vf-rise">
        <span className="vf-label">
          {t("mono.reviewQueue")}
          {queue.data ? ` · ${items.length}` : ""}
        </span>
        <h1 className="vf-serif">{t("review.queueTitle")}</h1>
        <p className="vf-muted">{t("review.queueLead")}</p>
      </header>
      <ErrorAlert error={queue.error} />
      {queue.isPending ? (
        <div className="vf-queue-grid" aria-busy="true">
          {["a", "b", "c"].map((key) => (
            <span key={key} className="vf-skel vf-queue-skel" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="vf-reviews-empty">
          <p className="vf-serif">{t("review.queueEmpty")}</p>
        </div>
      ) : (
        <div className="vf-queue-grid vf-rise-2">
          {items.map((job) => (
            <QueueCard key={job.id} job={job} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 左邊加黑邊的大監看播放器 */
function ReviewMonitor({ job }: { job: JobDetail }) {
  const { t } = useTranslation();
  return (
    <section className="vf-review-monitor" aria-label={t("review.monitor")}>
      <div className="vf-review-stage">
        {job.final_asset_id ? (
          // biome-ignore lint/a11y/useMediaCaption: 成片字幕已燒錄進畫面
          <video
            data-testid="final-video"
            src={assetContentUrl(job.final_asset_id)}
            poster={job.cover_asset_id ? assetContentUrl(job.cover_asset_id) : undefined}
            controls
            preload="metadata"
            playsInline
          />
        ) : (
          <p className="vf-note">{t("library.noFinal")}</p>
        )}
      </div>
      <span className="vf-mono vf-muted vf-review-spec">
        {[
          t(`videoType.${job.video_type}`),
          job.ratio,
          ...(job.runtime_s ? [formatRuntime(job.runtime_s)] : []),
          job.draft_mode ? t("jobDetail.draftMode") : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </section>
  );
}

/** 審核頁：左邊監看播放器，右邊審核單，下方審核紀錄 */
export function ReviewDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const job = useJob(id);
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();

  if (job.isPending) {
    return (
      <div className="vf-reviews" aria-busy="true">
        <span className="vf-skel vf-skel-heading" />
        <span className="vf-skel vf-skel-block" />
      </div>
    );
  }
  if (job.isError) return <ErrorResult error={job.error} onRetry={() => void job.refetch()} />;
  const data = job.data;
  const canReview = data.allowed_actions.includes("review");

  return (
    <div className="vf-reviews">
      <header className="vf-review-head vf-rise">
        <span className="vf-mono vf-review-kicker">
          <Link to="/reviews" className="vf-link">
            ← {t("review.queueTitle")}
          </Link>
          <span aria-hidden="true"> / </span>
          {t("mono.review")} · {jobCode(data)}
        </span>
        <div className="vf-review-title">
          <h1 className="vf-serif">{data.title}</h1>
          <JobStatusTag status={data.status} />
          <Link to={`/jobs/${data.id}`} className="vf-link">
            {t("review.openJob")}
          </Link>
        </div>
      </header>
      <div className="vf-review-layout vf-rise-2">
        <ReviewMonitor job={data} />
        <aside className="vf-review-sheet" aria-labelledby="vf-review-sheet-title">
          <div className="vf-review-sheet-head">
            <span className="vf-label">{t("mono.reviewSheet")}</span>
            <h2 id="vf-review-sheet-title" className="vf-serif">
              {t("review.sheet")}
            </h2>
          </div>
          {canReview ? (
            <ReviewForm
              job={data}
              onDone={() => {
                void message.success(t("review.done"));
                void navigate(`/jobs/${data.id}`);
              }}
            />
          ) : (
            <p className="vf-note">{t("review.notReviewable")}</p>
          )}
          <ReviewHistory reviews={data.reviews} />
        </aside>
      </div>
    </div>
  );
}
