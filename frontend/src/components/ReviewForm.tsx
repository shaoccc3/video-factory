import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useJobCommand } from "../api/hooks";
import { CHECKLIST_KEYS, type ChecklistKey, type JobDetail } from "../api/types";
import { ErrorAlert } from "./ErrorResult";
import "./review.css";

type Checklist = Record<ChecklistKey, boolean>;

const EMPTY_CHECKLIST = Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, false])) as Checklist;

export function allChecked(checklist: Checklist): boolean {
  return CHECKLIST_KEYS.every((key) => checklist[key]);
}

/** 審核單：通過需五項全勾；退回必填原因 */
export function ReviewForm({ job, onDone }: { job: JobDetail; onDone?: () => void }) {
  const { t } = useTranslation();
  const [checklist, setChecklist] = useState<Checklist>(EMPTY_CHECKLIST);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const command = useJobCommand(job.id);
  const complete = allChecked(checklist);
  const checked = CHECKLIST_KEYS.filter((key) => checklist[key]).length;
  const pending = command.isPending ? command.variables : undefined;
  const deciding = pending?.type === "review" ? pending.body.decision : undefined;

  const decide = (decision: "approved" | "rejected") => {
    if (decision === "rejected" && !reason.trim()) {
      setReasonError(true);
      return;
    }
    if (decision === "approved" && !complete) return;
    command.mutate(
      { type: "review", body: { decision, checklist, reason: reason.trim() } },
      { onSuccess: () => onDone?.() },
    );
  };

  return (
    <div className="vf-review-form">
      <fieldset className="vf-review-checks">
        <legend className="vf-review-legend">
          <span className="vf-label">{t("review.checklistTitle")}</span>
          <span className="vf-mono vf-muted">
            {checked} / {CHECKLIST_KEYS.length}
          </span>
        </legend>
        {CHECKLIST_KEYS.map((key, i) => (
          <label key={key} className="vf-review-check" data-checked={checklist[key]}>
            <input
              type="checkbox"
              checked={checklist[key]}
              onChange={(e) => setChecklist((cur) => ({ ...cur, [key]: e.target.checked }))}
            />
            <span className="vf-review-box" aria-hidden="true" />
            <span className="vf-mono vf-review-no" aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span>{t(`review.checklist.${key}`)}</span>
          </label>
        ))}
      </fieldset>
      <label className="vf-review-reason">
        <span className="vf-label">{t("review.reasonLabel")}</span>
        <textarea
          className="vf-slate-input"
          aria-label={t("review.reason")}
          rows={4}
          value={reason}
          aria-invalid={reasonError}
          placeholder={t("review.reasonPlaceholder")}
          onChange={(e) => {
            setReason(e.target.value);
            if (e.target.value.trim()) setReasonError(false);
          }}
        />
      </label>
      {reasonError && (
        <span className="vf-field-error" role="alert">
          {t("review.reasonRequired")}
        </span>
      )}
      {!complete && <p className="vf-note">{t("review.checklistHint")}</p>}
      <ErrorAlert error={command.error} />
      <div className="vf-review-decide">
        <button
          type="button"
          className="vf-btn vf-btn-ghost vf-btn-lg vf-btn-danger"
          disabled={command.isPending}
          aria-busy={deciding === "rejected"}
          onClick={() => decide("rejected")}
        >
          {t("review.reject")}
        </button>
        <button
          type="button"
          className="vf-btn vf-btn-primary vf-btn-lg"
          disabled={!complete || command.isPending}
          aria-busy={deciding === "approved"}
          onClick={() => decide("approved")}
        >
          {t("review.approve")}
        </button>
      </div>
    </div>
  );
}
