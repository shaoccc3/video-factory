import { App as AntdApp, Modal, Select } from "antd";
import { type DragEvent, type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import {
  useBatch,
  useBatches,
  useCreateBatchCsv,
  useCreateBatchImages,
  useTemplates,
} from "../api/hooks";
import { type Batch, JOB_STATUSES, type JobStatus } from "../api/types";
import { hasRole, useCurrentUser } from "../auth/auth";
import { ErrorAlert, ErrorResult } from "../components/ErrorResult";
import { jobCode } from "../components/job/JobHeader";
import { jobTone } from "../components/StatusTag";
import { Toggle } from "../components/studio/Toggle";
import { useNow } from "../hooks/motion";
import { formatDateTime } from "../utils/format";
import { FilmFrame } from "./StudioPage";
import "./slate.css";
import "./batches.css";

const MAX_PARALLEL = 10;

/** 依狀態上色的分段進度條與各狀態數量 */
function ReelProgress({ batch }: { batch: Batch }) {
  const { t } = useTranslation();
  const entries = JOB_STATUSES.flatMap((status) => {
    const n = batch.counts[status] ?? 0;
    return n > 0 ? [[status, n] as [JobStatus, number]] : [];
  });
  const total = Math.max(batch.total, 1);
  return (
    <div className="vf-roll-progress">
      <div className="vf-segments" aria-hidden="true">
        {entries.map(([status, n]) => (
          <span
            key={status}
            className={`vf-seg vf-seg-${jobTone(status)}`}
            style={{ flexGrow: n, flexBasis: `${(n / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="vf-roll-counts">
        {entries.map(([status, n]) => (
          <li key={status}>
            <span className={`vf-seg-dot vf-seg-${jobTone(status)}`} aria-hidden="true" />
            {t(`jobStatus.${status}`)} <span className="vf-mono">{n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReelState({ status }: { status: Batch["status"] }) {
  const { t } = useTranslation();
  return (
    <span className="vf-roll-state vf-mono" data-status={status}>
      {status === "running" && <span className="vf-rec-dot" aria-hidden="true" />}
      {t(`batches.${status}`)}
    </span>
  );
}

/** 拖放或選擇檔案的虛線格（場記板裡的一格） */
function DropCell({
  label,
  hint,
  accept,
  multiple,
  files,
  onFiles,
}: {
  label: string;
  hint: string;
  accept: string;
  multiple: boolean;
  files: File[];
  onFiles: (files: File[]) => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const dropped = Array.from(event.dataTransfer.files);
    onFiles(multiple ? dropped : dropped.slice(0, 1));
  };
  return (
    <section
      className="vf-drop-cell"
      aria-label={label}
      data-over={over}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        className="vf-sr-only"
        accept={accept}
        multiple={multiple}
        tabIndex={-1}
        aria-label={label}
        onChange={(e) => onFiles(Array.from(e.target.files ?? []))}
      />
      {files.length > 0 ? (
        <ul className="vf-drop-files">
          {files.map((f) => (
            <li key={`${f.name}-${f.size}-${f.lastModified}`} className="vf-mono">
              {f.name}
            </li>
          ))}
        </ul>
      ) : (
        <span className="vf-muted">{hint}</span>
      )}
      <button
        type="button"
        className="vf-btn vf-btn-ghost"
        onClick={() => inputRef.current?.click()}
      >
        {files.length > 0 ? t("batches.replaceFiles") : t("assets.chooseFile")}
      </button>
    </section>
  );
}

type Source = "csv" | "images";

/** 新增批量：場記板風格的對話框（CSV 或多張圖片、並發數、樣片模式） */
function CreateBatchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const templates = useTemplates();
  const csv = useCreateBatchCsv();
  const images = useCreateBatchImages();
  const [source, setSource] = useState<Source>("csv");
  const [templateId, setTemplateId] = useState<string | undefined>();
  const [files, setFiles] = useState<File[]>([]);
  const [topic, setTopic] = useState("");
  const [parallel, setParallel] = useState(2);
  const [draft, setDraft] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pending = csv.isPending || images.isPending;
  const options = (templates.data ?? [])
    .filter((tpl) => source === "csv" || tpl.video_type === "quick")
    .map((tpl) => ({ value: tpl.id, label: tpl.name }));

  const switchSource = (next: Source) => {
    setSource(next);
    setFiles([]);
    setTemplateId(undefined);
    setErrors({});
  };

  const done = (batch: Batch) => {
    onClose();
    void message.success(t("batches.created"));
    void navigate(`/batches/${batch.id}`);
  };

  const submit = () => {
    const next: Record<string, string> = {};
    if (!templateId) next.template = t("batches.templateRequired");
    if (files.length === 0) next.files = t("batches.filesRequired");
    if (source === "images" && !topic.trim()) next.topic = t("batches.topicRequired");
    setErrors(next);
    if (!templateId || Object.keys(next).length > 0) return;
    const common = { template_id: templateId, max_parallel: parallel, draft_mode: draft };
    const [first] = files;
    if (source === "csv" && first) {
      csv.mutate({ ...common, file: first }, { onSuccess: done });
    } else {
      images.mutate({ ...common, files, topic: topic.trim() }, { onSuccess: done });
    }
  };

  const cell = (key: string, label: string, body: ReactNode, wide = false) => (
    <div className={wide ? "vf-cell vf-cell-wide" : "vf-cell"}>
      <span className="vf-label" id={`vf-batch-${key}`}>
        {label}
      </span>
      {body}
      {errors[key] && (
        <span className="vf-field-error" role="alert">
          {errors[key]}
        </span>
      )}
    </div>
  );

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      title={t("batches.create")}
      rootClassName="vf-batch-dialog"
      destroyOnHidden
    >
      <div className="vf-slate">
        <div className="vf-slate-top" aria-hidden="true">
          <div className="vf-slate-stick" />
          <div className="vf-slate-hinge" />
          <div className="vf-slate-band" />
        </div>
        <div className="vf-slate-grid">
          {cell(
            "source",
            t("batches.sourceLabel"),
            <fieldset className="vf-tabs" aria-labelledby="vf-batch-source">
              {(["csv", "images"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className="vf-tab vf-slate-grow"
                  aria-pressed={source === s}
                  onClick={() => switchSource(s)}
                >
                  {s === "csv" ? t("batches.fromCsv") : t("batches.fromImages")}
                </button>
              ))}
            </fieldset>,
            true,
          )}
          {cell(
            "template",
            t("batches.templateLabel"),
            <Select
              aria-labelledby="vf-batch-template"
              loading={templates.isPending}
              value={templateId}
              onChange={setTemplateId}
              options={options}
              placeholder={source === "images" ? t("batches.quickOnly") : undefined}
            />,
            true,
          )}
          {cell(
            "files",
            source === "csv" ? t("batches.csvLabel") : t("batches.imagesLabel"),
            <DropCell
              label={source === "csv" ? t("batches.csvFile") : t("batches.images")}
              hint={source === "csv" ? t("batches.csvHelp") : t("batches.dropImages")}
              accept={source === "csv" ? ".csv,text/csv" : "image/png,image/jpeg,image/webp"}
              multiple={source === "images"}
              files={files}
              onFiles={setFiles}
            />,
            true,
          )}
          {source === "images" &&
            cell(
              "topic",
              t("batches.topicLabel"),
              <textarea
                className="vf-slate-input"
                rows={2}
                value={topic}
                aria-labelledby="vf-batch-topic"
                onChange={(e) => setTopic(e.target.value)}
              />,
              true,
            )}
          {cell(
            "parallel",
            t("batches.parallelLabel"),
            <div className="vf-stepper">
              <button
                type="button"
                className="vf-icon-btn"
                aria-label={t("batches.fewer")}
                disabled={parallel <= 1}
                onClick={() => setParallel((n) => Math.max(1, n - 1))}
              >
                −
              </button>
              <output className="vf-mono" aria-labelledby="vf-batch-parallel">
                {parallel}
              </output>
              <button
                type="button"
                className="vf-icon-btn"
                aria-label={t("batches.more")}
                disabled={parallel >= MAX_PARALLEL}
                onClick={() => setParallel((n) => Math.min(MAX_PARALLEL, n + 1))}
              >
                ＋
              </button>
            </div>,
          )}
          {cell(
            "draft",
            t("batches.draftLabel"),
            <div className="vf-slate-option">
              <div>
                <span className="vf-note">{t("wizard.fields.draftModeHelp")}</span>
              </div>
              <Toggle checked={draft} onChange={setDraft} labelledBy="vf-batch-draft" />
            </div>,
          )}
          <div className="vf-cell vf-cell-wide vf-slate-foot">
            <ErrorAlert error={csv.error ?? images.error} />
            <span className="vf-mono vf-slate-roll">
              {t("mono.batch")} · {t("batches.rollHint")}
            </span>
            <button
              type="button"
              className="vf-btn vf-btn-primary vf-slate-go"
              disabled={pending}
              aria-busy={pending}
              onClick={submit}
            >
              {source === "images"
                ? t("batches.submitImages", { count: files.length })
                : t("batches.submit")}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** 批量清單：每列一卷 */
export function BatchesPage() {
  const { t, i18n } = useTranslation();
  const batches = useBatches();
  const [open, setOpen] = useState(false);
  const items = batches.data ?? [];
  return (
    <div className="vf-batches">
      <header className="vf-batches-head vf-rise">
        <div>
          <span className="vf-label">
            {t("mono.batchReels")}
            {batches.data ? ` · ${items.length}` : ""}
          </span>
          <h1 className="vf-serif">{t("batches.title")}</h1>
        </div>
        <button
          type="button"
          className="vf-btn vf-btn-primary vf-btn-lg"
          onClick={() => setOpen(true)}
        >
          {t("batches.create")}
        </button>
      </header>
      <ErrorAlert error={batches.error} />
      {batches.isPending ? (
        <span className="vf-skel vf-skel-block" aria-busy="true" />
      ) : items.length === 0 ? (
        <p className="vf-batches-empty">{t("batches.empty")}</p>
      ) : (
        <ul className="vf-rolls vf-rise-2">
          {items.map((batch) => (
            <li key={batch.id} className="vf-roll-row">
              <div className="vf-roll-id">
                <span className="vf-mono vf-roll-code">{jobCode(batch)}</span>
                <ReelState status={batch.status} />
              </div>
              <div className="vf-roll-main">
                <Link to={`/batches/${batch.id}`} className="vf-stretched vf-serif vf-roll-title">
                  {batch.template_name}
                </Link>
                <span className="vf-mono vf-muted">
                  {t("batches.reelSpec", { total: batch.total, parallel: batch.max_parallel })}
                  {" · "}
                  {formatDateTime(batch.created_at, i18n.language)}
                </span>
              </div>
              <ReelProgress batch={batch} />
            </li>
          ))}
        </ul>
      )}
      <CreateBatchDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

/** 批量詳情：片場底片式的任務網格 */
export function BatchDetailPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const user = useCurrentUser();
  const now = useNow(1000);
  const batch = useBatch(id);
  if (batch.isPending) {
    return (
      <div className="vf-batches" aria-busy="true">
        <span className="vf-skel vf-skel-heading" />
        <span className="vf-skel vf-skel-block" />
      </div>
    );
  }
  if (batch.isError)
    return <ErrorResult error={batch.error} onRetry={() => void batch.refetch()} />;
  const data = batch.data;
  return (
    <div className="vf-batches">
      <header className="vf-batch-head vf-rise">
        <span className="vf-mono vf-batch-kicker">
          <Link to="/batches" className="vf-link">
            ← {t("batches.title")}
          </Link>
          <span aria-hidden="true"> / </span>
          {t("mono.batch")} · {jobCode(data)}
        </span>
        <div className="vf-batch-title">
          <h1 className="vf-serif">{t("batches.detailTitle", { name: data.template_name })}</h1>
          <ReelState status={data.status} />
        </div>
        <span className="vf-mono vf-muted">
          {t("batches.reelSpec", { total: data.total, parallel: data.max_parallel })}
          {" · "}
          {formatDateTime(data.created_at, i18n.language)}
        </span>
      </header>
      <ReelProgress batch={data} />
      <div className="vf-strip vf-batch-strip vf-rise-2">
        <div className="vf-sprockets" aria-hidden="true" />
        <ul className="vf-strip-frames vf-batch-frames">
          {data.jobs.map((job) => (
            <li key={job.id}>
              <FilmFrame job={job} now={now} reviewer={hasRole(user, "reviewer")} />
            </li>
          ))}
        </ul>
        <div className="vf-sprockets" aria-hidden="true" />
      </div>
    </div>
  );
}
