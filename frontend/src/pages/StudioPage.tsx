import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { api, assetContentUrl, assetThumbnailUrl } from "../api/client";
import { queryKeys, useTemplates } from "../api/hooks";
import type { JobStatus, JobSummary, Template } from "../api/types";
import { hasRole, useCurrentUser } from "../auth/auth";
import { ErrorAlert } from "../components/ErrorResult";
import { JobStatusTag } from "../components/StatusTag";
import { PosterFallback } from "../components/studio/PosterFallback";
import {
  formatSeconds,
  useDocumentVisible,
  useNow,
  usePrefersReducedMotion,
} from "../hooks/motion";
import { useInView } from "../hooks/useInView";
import { deriveTitle } from "../utils/format";
import "./studio.css";

/** 片場底片列出的狀態：進行中與需要處理的 */
export const IN_PRODUCTION: JobStatus[] = [
  "scripting",
  "storyboard_ready",
  "generating",
  "composing",
  "in_review",
  "rejected",
  "failed",
  "budget_exceeded",
];

const SLIDE_MS = 6000;

function durationRange(tpl: Template): string {
  if (tpl.max_duration_s >= 60) {
    return `${Math.round(tpl.min_duration_s / 60)}–${Math.round(tpl.max_duration_s / 60)}M`;
  }
  return `${tpl.min_duration_s}–${tpl.max_duration_s}S`;
}

function filmDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

// ---- 放映區 --------------------------------------------------------------------

function Showreel({ films }: { films: JobSummary[] }) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref);
  const visible = useDocumentVisible();
  const reduced = usePrefersReducedMotion();
  const count = films.length;

  useEffect(() => {
    if (count < 2 || reduced || !visible || !inView) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % count), SLIDE_MS);
    return () => window.clearInterval(id);
  }, [count, reduced, visible, inView]);

  if (count === 0) {
    return (
      <section ref={ref} className="vf-reel" aria-label={t("studio.nowShowing")}>
        <PosterFallback
          size="lg"
          title={t("studio.reelEmptyTitle")}
          kicker={t("studio.reelEmptyBody")}
        />
        <Letterbox />
      </section>
    );
  }

  const active = index % count;
  const playVideo = inView && visible && !reduced;
  return (
    <section ref={ref} className="vf-reel" aria-label={t("studio.nowShowing")}>
      {films.map((film, i) => {
        const on = i === active;
        return (
          <div
            key={film.id}
            className={on ? "vf-reel-slide is-active" : "vf-reel-slide"}
            aria-hidden={!on}
          >
            <div className={i % 2 ? "vf-reel-kb vf-reel-kb-alt" : "vf-reel-kb"}>
              {on && playVideo && film.final_asset_id ? (
                <video
                  src={assetContentUrl(film.final_asset_id)}
                  poster={film.cover_asset_id ? assetThumbnailUrl(film.cover_asset_id) : undefined}
                  muted
                  loop
                  autoPlay
                  playsInline
                  preload="metadata"
                />
              ) : film.cover_asset_id ? (
                <img src={assetThumbnailUrl(film.cover_asset_id)} alt="" />
              ) : (
                <PosterFallback size="lg" title={film.title} />
              )}
            </div>
          </div>
        );
      })}
      <div className="vf-reel-scrim" aria-hidden="true" />
      <Letterbox />
      <div className="vf-reel-kicker vf-label">
        <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
          <path d="M1 0.5 L9 5 L1 9.5Z" fill="var(--vf-accent)" />
        </svg>
        {t("studio.nowShowing")}　{String(active + 1).padStart(2, "0")} /{" "}
        {String(count).padStart(2, "0")}
      </div>
      <div className="vf-reel-titles">
        {films.map((film, i) => (
          <div
            key={film.id}
            className={i === active ? "vf-reel-title is-active" : "vf-reel-title"}
            aria-hidden={i !== active}
          >
            <span className="vf-label vf-reel-meta">
              {t(`videoType.${film.video_type}`)} · {film.ratio} · {filmDate(film.updated_at)}
            </span>
            {i === active ? (
              <h1 className="vf-serif">{film.title}</h1>
            ) : (
              <p className="vf-serif">{film.title}</p>
            )}
            <span className="vf-reel-sub">{film.template_name}</span>
          </div>
        ))}
      </div>
      <div className="vf-reel-controls">
        {count > 1 && (
          <div className="vf-reel-dots">
            {films.map((film, i) => (
              <button
                key={film.id}
                type="button"
                aria-label={t("studio.slide", { n: i + 1 })}
                aria-pressed={i === active}
                onClick={() => setIndex(i)}
              >
                <span>
                  {i === active && !reduced && (
                    <span key={`fill-${active}`} className="vf-reel-fill" />
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
        <Link to={`/jobs/${films[active]?.id ?? ""}`} className="vf-btn vf-reel-play">
          <svg viewBox="0 0 10 10" width="11" height="11" aria-hidden="true">
            <path d="M1.5 0.8 L9 5 L1.5 9.2Z" fill="currentColor" />
          </svg>
          {t("studio.playFilm")}
        </Link>
      </div>
    </section>
  );
}

function Letterbox() {
  return (
    <>
      <div className="vf-letterbox vf-letterbox-top" aria-hidden="true" />
      <div className="vf-letterbox vf-letterbox-bottom" aria-hidden="true" />
      <span className="vf-corner vf-corner-tl" aria-hidden="true" />
      <span className="vf-corner vf-corner-tr" aria-hidden="true" />
      <span className="vf-corner vf-corner-bl" aria-hidden="true" />
      <span className="vf-corner vf-corner-br" aria-hidden="true" />
    </>
  );
}

// ---- 快速開片 --------------------------------------------------------------------

function QuickSlate() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const templates = useTemplates();
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [needTopic, setNeedTopic] = useState(false);
  const list = (templates.data ?? []).filter((tpl) => tpl.is_active);
  const current = list.find((tpl) => tpl.id === templateId) ?? list[0];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!current) return;
    if (!topic.trim()) {
      setNeedTopic(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const job = await api.createJob({
        template_id: current.id,
        title: deriveTitle(topic),
        inputs: { topic: topic.trim() },
      });
      await api.submitJob(job.id);
      void navigate(`/jobs/${job.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  const fullSettings = () => {
    const params = new URLSearchParams();
    if (current) params.set("template", current.id);
    if (topic.trim()) params.set("topic", topic.trim());
    void navigate(`/jobs/new?${params.toString()}`);
  };

  return (
    <form
      className="vf-quick"
      onSubmit={(event) => void submit(event)}
      aria-label={t("studio.quickLabel")}
    >
      <span className="vf-quick-stick" aria-hidden="true" />
      <label className="vf-quick-field">
        <span className="vf-label">{t("studio.sceneZero")}</span>
        <textarea
          rows={2}
          value={topic}
          maxLength={500}
          aria-invalid={needTopic && !topic.trim()}
          placeholder={t("studio.topicPlaceholder")}
          onChange={(event) => {
            setTopic(event.target.value);
            setNeedTopic(false);
          }}
        />
        {needTopic && !topic.trim() && (
          <span className="vf-field-error">{t("studio.topicRequired")}</span>
        )}
      </label>
      <div className="vf-quick-controls">
        <fieldset className="vf-tabs" aria-label={t("studio.typeLabel")}>
          {list.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              className="vf-tab"
              aria-pressed={tpl.id === current?.id}
              onClick={() => setTemplateId(tpl.id)}
            >
              <span>{tpl.name}</span>
              <span className="vf-mono vf-tab-sub">{durationRange(tpl)}</span>
            </button>
          ))}
        </fieldset>
        <button type="button" className="vf-btn vf-btn-ghost" onClick={fullSettings}>
          {t("studio.fullSettings")}
        </button>
        <button
          type="submit"
          className="vf-btn vf-btn-primary vf-quick-go"
          disabled={busy || !current}
        >
          {t("studio.write")}
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M5 12h14M13 6l6 6-6 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {error ? (
        <div className="vf-quick-error">
          <ErrorAlert error={error} />
        </div>
      ) : null}
    </form>
  );
}

// ---- 片場底片 --------------------------------------------------------------------

function frameAction(job: JobSummary, reviewer: boolean): { to: string; label: string } {
  switch (job.status) {
    case "storyboard_ready":
      return { to: `/jobs/${job.id}`, label: "studio.action.confirm" };
    case "in_review":
      return reviewer
        ? { to: `/reviews/${job.id}`, label: "studio.action.review" }
        : { to: `/jobs/${job.id}`, label: "studio.action.view" };
    case "failed":
    case "budget_exceeded":
    case "rejected":
      return { to: `/jobs/${job.id}`, label: "studio.action.fix" };
    default:
      return { to: `/jobs/${job.id}`, label: "studio.action.view" };
  }
}

/** 片場底片的一格（批量詳情也用） */
export function FilmFrame({
  job,
  now,
  reviewer,
}: {
  job: JobSummary;
  now: Date;
  reviewer: boolean;
}) {
  const { t } = useTranslation();
  const action = frameAction(job, reviewer);
  const preview = job.preview_asset_id;
  const { total, succeeded } = job.progress;
  const elapsed = (now.getTime() - Date.parse(job.updated_at)) / 1000;
  const cost = job.actual_cost_cny > 0 ? job.actual_cost_cny : job.estimated_cost_cny;
  return (
    <article className="vf-frame vf-zoom">
      {preview ? (
        <img src={assetThumbnailUrl(preview)} alt="" loading="lazy" />
      ) : (
        <PosterFallback size="sm" title={job.title} kicker={job.template_name} />
      )}
      <div className="vf-frame-scrim" aria-hidden="true" />
      <div className="vf-frame-top">
        <JobStatusTag status={job.status} />
        {job.status === "generating" && (
          <span className="vf-mono vf-frame-tc" title={t("studio.elapsed")}>
            +{formatSeconds(elapsed)}
          </span>
        )}
      </div>
      <div className="vf-frame-bottom">
        <div className="vf-frame-text">
          <Link to={`/jobs/${job.id}`} className="vf-frame-title vf-stretched">
            {job.title}
          </Link>
          <span className="vf-label vf-frame-meta">
            {total > 0 ? `${t("studio.shots", { count: total })} · ` : ""}
            {job.template_name}
            {cost ? ` · ¥${cost.toFixed(2)}` : ""}
          </span>
        </div>
        <Link to={action.to} className="vf-btn vf-btn-light vf-reveal vf-frame-action">
          {t(action.label)}
        </Link>
      </div>
      {job.status === "generating" && total > 0 && (
        <div
          className="vf-frame-progress"
          role="progressbar"
          aria-label={t("studio.progress")}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={succeeded}
        >
          <div
            className="vf-frame-progress-bar"
            style={{ transform: `scaleX(${Math.max(succeeded / total, 0.04)})` }}
          >
            <span className="vf-frame-progress-scan" />
          </div>
        </div>
      )}
    </article>
  );
}

function ProductionStrip() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const now = useNow(250);
  const params = { status: IN_PRODUCTION, sort: "updated" as const, page_size: 12 };
  const jobs = useQuery({
    queryKey: queryKeys.jobs(params),
    queryFn: () => api.listJobs(params),
    refetchInterval: 10_000,
  });
  const items = jobs.data?.items ?? [];
  return (
    <section className="vf-section vf-rise-2" aria-labelledby="studio-prod">
      <div className="vf-section-head">
        <div className="vf-section-title">
          <h2 id="studio-prod" className="vf-serif">
            {t("nav.studio")}
          </h2>
          <span className="vf-label">
            {t("studio.inProduction")} · {String(jobs.data?.total ?? 0).padStart(2, "0")}
          </span>
        </div>
        <Link to="/jobs" className="vf-link">
          {t("studio.allJobs")}
        </Link>
      </div>
      <div className="vf-strip">
        <div className="vf-sprockets" aria-hidden="true" />
        {jobs.isError ? (
          <div className="vf-strip-empty">
            <ErrorAlert error={jobs.error} />
          </div>
        ) : items.length === 0 ? (
          <div className="vf-strip-empty">
            <span className="vf-muted">
              {jobs.isPending ? t("studio.loading") : t("studio.stripEmpty")}
            </span>
            {!jobs.isPending && (
              <Link to="/jobs/new" className="vf-btn vf-btn-outline">
                {t("nav.newFilm")}
              </Link>
            )}
          </div>
        ) : (
          <ul className="vf-strip-frames">
            {items.map((job) => (
              <li key={job.id}>
                <FilmFrame job={job} now={now} reviewer={hasRole(user, "reviewer")} />
              </li>
            ))}
          </ul>
        )}
        <div className="vf-sprockets" aria-hidden="true" />
      </div>
    </section>
  );
}

// ---- 放映室精選 --------------------------------------------------------------------

function RecentCuts({ films }: { films: JobSummary[] }) {
  const { t } = useTranslation();
  return (
    <section className="vf-section vf-section-pad vf-rise-3" aria-labelledby="studio-recent">
      <div className="vf-section-head">
        <div className="vf-section-title">
          <h2 id="studio-recent" className="vf-serif">
            {t("nav.library")}
          </h2>
          <span className="vf-label">{t("studio.recentCuts")}</span>
        </div>
        <Link to="/library" className="vf-link">
          {t("studio.openLibrary")}
        </Link>
      </div>
      {films.length === 0 ? (
        <p className="vf-muted">{t("studio.recentEmpty")}</p>
      ) : (
        <div className="vf-cuts">
          {films.map((film, i) => (
            <Link
              key={film.id}
              to={`/library?play=${film.id}`}
              className={i === 0 ? "vf-cut vf-cut-lead vf-zoom" : "vf-cut vf-zoom"}
            >
              {film.cover_asset_id ? (
                <img src={assetThumbnailUrl(film.cover_asset_id)} alt="" loading="lazy" />
              ) : (
                <PosterFallback title={film.title} />
              )}
              <div className="vf-frame-scrim" aria-hidden="true" />
              <span className="vf-cut-play vf-reveal" aria-hidden="true">
                <svg viewBox="0 0 10 10" width="16" height="16" aria-hidden="true">
                  <path d="M2 0.8 L9.2 5 L2 9.2Z" fill="currentColor" />
                </svg>
              </span>
              <span className="vf-cut-text">
                <span className="vf-label vf-cut-meta">
                  {film.ratio} · {filmDate(film.updated_at)}
                </span>
                <span className="vf-serif vf-cut-title">{film.title}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

/** 片場（首頁）：放映區、快速開片、片場底片、放映室精選（規格 14 第 4 節） */
export function StudioPage() {
  const { t } = useTranslation();
  const reelParams = {
    status: ["approved", "in_review"] as JobStatus[],
    sort: "updated" as const,
    page_size: 8,
  };
  const reel = useQuery({
    queryKey: queryKeys.jobs(reelParams),
    queryFn: () => api.listJobs(reelParams),
    refetchInterval: 60_000,
  });
  const cutsParams = { status: "approved" as JobStatus, sort: "updated" as const, page_size: 5 };
  const cuts = useQuery({
    queryKey: queryKeys.jobs(cutsParams),
    queryFn: () => api.listJobs(cutsParams),
  });
  const films = (reel.data?.items ?? [])
    .filter((job) => job.final_asset_id || job.cover_asset_id)
    .slice(0, 3);

  return (
    <div className="vf-studio">
      <div className="vf-reel-wrap">
        <Showreel films={films} />
        <QuickSlate />
      </div>
      <ProductionStrip />
      <RecentCuts films={cuts.data?.items ?? []} />
      <footer className="vf-studio-foot vf-label">
        <span>{t("studio.footLeft")}</span>
        <span>{t("studio.footRight")}</span>
      </footer>
    </div>
  );
}
