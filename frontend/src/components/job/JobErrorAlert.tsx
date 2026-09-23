import { Alert } from "antd";
import { useTranslation } from "react-i18next";
import type { ErrorKind, JobDetail } from "../../api/types";

export type ErrorCategory = "moderation" | "budget" | "system";

export function errorCategory(kind: ErrorKind | null): ErrorCategory {
  if (kind === "moderation") return "moderation";
  if (kind === "budget") return "budget";
  return "system";
}

/** 區分內容審核（用戶可修改內容）、預算與系統錯誤（可續跑或聯絡管理員） */
export function JobErrorAlert({ job }: { job: JobDetail }) {
  const { t } = useTranslation();
  const hasError = job.error_kind !== null || job.error_message !== null;
  if (!hasError && job.status !== "budget_exceeded") return null;

  const category = job.status === "budget_exceeded" ? "budget" : errorCategory(job.error_kind);
  const detail = [job.error_code, job.error_message].filter(Boolean).join(" · ");
  return (
    <Alert
      type={category === "system" ? "error" : "warning"}
      showIcon
      style={{ marginBottom: 16 }}
      data-testid={`job-error-${category}`}
      title={t(`jobError.${category}.title`)}
      description={
        <>
          <div>{t(`jobError.${category}.hint`)}</div>
          {detail && <div style={{ marginTop: 4 }}>{detail}</div>}
          {job.error_kind && category === "system" && (
            <div style={{ marginTop: 4 }}>
              {t("jobError.kind")}: {t(`errorKind.${job.error_kind}`)}
            </div>
          )}
        </>
      }
    />
  );
}
