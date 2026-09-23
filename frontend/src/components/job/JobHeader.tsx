import { Drawer } from "antd";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { JobDetail } from "../../api/types";
import { hasRole, useCurrentUser } from "../../auth/auth";
import { JobStatusTag } from "../StatusTag";
import { CallsTable } from "./JobPanels";

/** 片場代號：建立日期 MMDD 加任務 ID 前四碼，例如 0923-3F2A */
export function jobCode(job: { id: string; created_at: string }): string {
  const d = new Date(job.created_at);
  const mmdd = `${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `${mmdd}-${job.id.replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

/** 總長 M:SS */
export function formatRuntime(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** 任務頁頭：返回片場、代號、片名、狀態、規格摘要；右側放動作 */
export function JobHeader({
  job,
  kicker,
  children,
}: {
  job: JobDetail;
  kicker: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const total = job.scenes.reduce((sum, s) => sum + s.duration_s, 0);
  const spec = [
    t(`videoType.${job.video_type}`),
    job.ratio,
    ...(job.scenes.length > 0
      ? [t("shotList.shots", { count: job.scenes.length }), formatRuntime(total)]
      : []),
    t(`audioMode.${job.options.audio_mode}`),
  ];
  return (
    <header className="vf-job-head vf-rise">
      <div className="vf-job-head-main">
        <span className="vf-job-kicker vf-mono">
          <Link to="/" className="vf-link">
            ← {t("nav.studio")}
          </Link>
          <span aria-hidden="true"> / </span>
          {kicker} · {jobCode(job)}
        </span>
        <div className="vf-job-title">
          <h1 className="vf-serif">{job.title}</h1>
          <span data-testid="job-status" data-status={job.status}>
            <JobStatusTag status={job.status} />
          </span>
          {job.draft_mode && <span className="vf-job-chip">{t("jobDetail.draftMode")}</span>}
        </div>
        <span className="vf-job-spec vf-mono">{spec.join(" · ")}</span>
      </div>
      {children && <div className="vf-job-head-side">{children}</div>}
    </header>
  );
}

/** 調用記錄收進「技術細節」抽屜，只有管理員看得到（規格 14） */
export function TechDetails({ job }: { job: JobDetail }) {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const [open, setOpen] = useState(false);
  if (!hasRole(user, "admin")) return null;
  return (
    <>
      <button type="button" className="vf-btn vf-btn-ghost" onClick={() => setOpen(true)}>
        {t("shotList.techDetails")}
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={t("shotList.techDetails")}
        size="large"
        destroyOnHidden
      >
        {open && <CallsTable job={job} />}
      </Drawer>
    </>
  );
}
