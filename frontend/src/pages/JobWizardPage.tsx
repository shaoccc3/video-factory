import { type CSSProperties, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import { api, assetContentUrl } from "../api/client";
import { useEstimatePreview, useMeta, useTemplates } from "../api/hooks";
import {
  type AudioMode,
  type EstimatePreviewRequest,
  type JobCreate,
  type PlatformMeta,
  RATIOS,
  type Ratio,
  type Template,
} from "../api/types";
import { canCreate, useCurrentUser } from "../auth/auth";
import { AssetPicker } from "../components/AssetPicker";
import { ErrorAlert, ErrorResult } from "../components/ErrorResult";
import { PosterFallback } from "../components/studio/PosterFallback";
import { Toggle } from "../components/studio/Toggle";
import { usePrefersReducedMotion } from "../hooks/motion";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { deriveTitle, formatCny } from "../utils/format";
import "./slate.css";

export interface WizardValues {
  title: string;
  topic: string;
  extra?: string;
  product_asset_ids?: string[];
  logo_asset_ids?: string[];
  bgm_asset_ids?: string[];
  image_asset_ids?: string[];
  ratio: Ratio;
  target_duration_s?: number | null;
  audio_mode: AudioMode;
  draft_mode: boolean;
  continuous_shots: boolean;
  /** 以下三項只在 audio_mode = native 時送出（v1.1） */
  voice_style?: string;
  music?: string;
  consistent_voice?: boolean;
}

/** 聲音方式的顯示順序：原生聲音優先 */
const AUDIO_MODE_ORDER: readonly AudioMode[] = ["native", "tts", "none"];

/** 依 /meta 決定可選的聲音方式；/meta 尚未載入或失敗時不隱藏任何選項 */
export function availableAudioModes(meta: PlatformMeta | undefined): AudioMode[] {
  if (!meta) return [...AUDIO_MODE_ORDER];
  const allowed = new Set(meta.audio_modes.length > 0 ? meta.audio_modes : AUDIO_MODE_ORDER);
  return AUDIO_MODE_ORDER.filter((m) => allowed.has(m) && (m !== "tts" || meta.tts_available));
}

/** 模板預設的聲音方式在目前區域不可用時改用 native */
export function defaultAudioMode(template: Template, meta: PlatformMeta | undefined): AudioMode {
  return availableAudioModes(meta).includes(template.audio_mode) ? template.audio_mode : "native";
}

const MAX_VOICE_TEXT = 100;
const MAX_TOPIC = 1000;
/** 預估的防抖時間（規格 14：參數變更後 400ms 重算） */
const ESTIMATE_DEBOUNCE_MS = 400;
/** 打板動畫的長度；送出至少等這麼久再換頁，動作才看得完整 */
const CLAP_MS = 600;

/** 把場記板轉成 JobCreate（只送契約內的欄位） */
export function buildJobCreate(template: Template, values: WizardValues): JobCreate {
  const body: JobCreate = {
    template_id: template.id,
    title: values.title.trim(),
    inputs: { topic: values.topic.trim(), extra: values.extra?.trim() ?? "" },
    ratio: values.ratio,
    target_duration_s: values.target_duration_s ?? null,
    audio_mode: values.audio_mode,
    draft_mode: values.draft_mode,
    continuous_shots: values.continuous_shots,
    logo_asset_id: values.logo_asset_ids?.[0] ?? null,
    bgm_asset_id: values.bgm_asset_ids?.[0] ?? null,
  };
  if (template.video_type === "quick") {
    body.image_asset_id = values.image_asset_ids?.[0] ?? null;
  } else {
    body.product_asset_ids = values.product_asset_ids ?? [];
  }
  if (values.audio_mode === "native") {
    // 空字串不送，讓後端用預設值
    const voiceStyle = values.voice_style?.trim() ?? "";
    const music = values.music?.trim() ?? "";
    if (voiceStyle) body.voice_style = voiceStyle;
    if (music) body.music = music;
    body.consistent_voice = values.consistent_voice ?? false;
  }
  return body;
}

interface FieldErrors {
  template?: string | undefined;
  topic?: string | undefined;
}

function templateDefaults(template: Template, meta: PlatformMeta | undefined) {
  return {
    ratio: template.ratio,
    audio_mode: defaultAudioMode(template, meta),
    target_duration_s: null,
  } satisfies Partial<WizardValues>;
}

function ratioParts(ratio: Ratio): [number, number] {
  const [w, h] = ratio.split(":").map(Number);
  return [w ?? 1, h ?? 1];
}

/** 畫幅鈕上的小框：長邊 16px */
function RatioGlyph({ ratio }: { ratio: Ratio }) {
  const [w, h] = ratioParts(ratio);
  const scale = 16 / Math.max(w, h);
  return (
    <span
      className="vf-ratio-glyph"
      aria-hidden="true"
      style={{ width: Math.round(w * scale), height: Math.round(h * scale) }}
    />
  );
}

/** 場記板上的長度只到秒：M:SS */
function durationLabel(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function slateDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

function productionCode(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

/** 右欄的構圖預覽：依畫幅變形，顯示已選的商品圖或首幀，三分線加字幕安全區 */
function Monitor({
  ratio,
  resolution,
  imageId,
  title,
}: {
  ratio: Ratio;
  resolution: string | undefined;
  imageId: string | undefined;
  title: string;
}) {
  const { t } = useTranslation();
  const [w, h] = ratioParts(ratio);
  const frameStyle = { "--vf-rw": w, "--vf-rh": h } as CSSProperties;
  return (
    <div className="vf-slate-aside-block">
      <span className="vf-label">{t("slate.monitor")}</span>
      <div className="vf-monitor">
        <div className="vf-monitor-frame" style={frameStyle} data-testid="monitor-frame">
          {imageId ? (
            <div className="vf-monitor-image">
              <img src={assetContentUrl(imageId)} alt={t("slate.monitorImage")} />
            </div>
          ) : (
            <PosterFallback title={title} kicker={t("slate.noReference")} size="sm" />
          )}
          <span className="vf-monitor-third vf-monitor-third-h1" aria-hidden="true" />
          <span className="vf-monitor-third vf-monitor-third-h2" aria-hidden="true" />
          <span className="vf-monitor-third vf-monitor-third-v1" aria-hidden="true" />
          <span className="vf-monitor-third vf-monitor-third-v2" aria-hidden="true" />
          <span className="vf-monitor-safe" aria-hidden="true" />
        </div>
        <span className="vf-monitor-tag vf-mono">
          <span className="vf-monitor-dot" aria-hidden="true" />
          {t("slate.monitorFrame", {
            ratio,
            resolution: (resolution ?? "").toUpperCase(),
          })}
        </span>
        <span className="vf-monitor-safe-note vf-mono">{t("slate.safeArea")}</span>
      </div>
    </div>
  );
}

/** 右欄的預估費用：即時呼叫 POST /jobs/estimate，失敗不阻擋送出 */
function BudgetCard({
  request,
  draftMode,
  onDraftMode,
  disabled,
}: {
  request: EstimatePreviewRequest | null;
  draftMode: boolean;
  onDraftMode: (on: boolean) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const debounced = useDebouncedValue(request, ESTIMATE_DEBOUNCE_MS);
  const estimate = useEstimatePreview(debounced);
  const data = estimate.data;
  const pending = request !== debounced || estimate.isFetching;
  const pct =
    data && data.budget_per_job_cny > 0
      ? Math.round((data.total_cny / data.budget_per_job_cny) * 100)
      : 0;

  return (
    <section className="vf-budget" aria-labelledby="vf-budget-title">
      <div className="vf-budget-head">
        <span className="vf-label" id="vf-budget-title">
          {t("slate.budget")}
        </span>
        <output className="vf-budget-total vf-mono" aria-live="polite" data-pending={pending}>
          {data ? `≈ ${formatCny(data.total_cny)}` : "—"}
        </output>
      </div>
      {estimate.isError && !data ? (
        <p className="vf-note" role="status">
          {t("slate.estimateFailed")}
        </p>
      ) : !data ? (
        <p className="vf-note">{t("slate.estimating")}</p>
      ) : (
        <>
          <ul className="vf-budget-items">
            {data.items.map((item) => (
              <li key={`${item.label}-${item.model_key}`}>
                <span>{item.label}</span>
                <span className="vf-budget-leader" aria-hidden="true" />
                <span className="vf-mono">{formatCny(item.amount_cny)}</span>
              </li>
            ))}
          </ul>
          <div className="vf-budget-meter">
            <div className="vf-budget-bar" aria-hidden="true" data-over={!data.within_budget}>
              <span style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
            <span className="vf-mono vf-budget-share">
              {t("slate.budgetShare", { budget: formatCny(data.budget_per_job_cny), pct })}
            </span>
            {!data.within_budget && (
              <span className="vf-field-error" role="alert">
                {t("slate.overBudget")}
              </span>
            )}
          </div>
        </>
      )}
      <div className="vf-budget-draft">
        <div>
          <span id="vf-draft-label">{t("slate.draft")}</span>
          <span className="vf-note">{t("wizard.fields.draftModeHelp")}</span>
        </div>
        <Toggle
          checked={draftMode}
          onChange={onDraftMode}
          labelledBy="vf-draft-label"
          disabled={disabled}
        />
      </div>
    </section>
  );
}

export function JobWizardPage() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const templates = useTemplates();
  const meta = useMeta();
  const reducedMotion = usePrefersReducedMotion();
  const [today] = useState(() => new Date());
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [values, setValues] = useState<WizardValues>(() => ({
    title: "",
    topic: params.get("topic") ?? "",
    extra: "",
    product_asset_ids: [],
    logo_asset_ids: [],
    bgm_asset_ids: [],
    image_asset_ids: [],
    ratio: "9:16",
    target_duration_s: null,
    audio_mode: "native",
    draft_mode: false,
    continuous_shots: false,
    voice_style: "",
    music: "",
    consistent_voice: false,
  }));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [take, setTake] = useState(1);
  const [clapKey, setClapKey] = useState(0);
  const topicRef = useRef<HTMLTextAreaElement>(null);

  const template = templates.data?.find((tpl) => tpl.id === templateId) ?? null;
  const isQuick = template?.video_type === "quick";
  const audioModes = availableAudioModes(meta.data);
  /** 模板預設 TTS，但目前區域不提供 */
  const ttsFallback = template?.audio_mode === "tts" && !audioModes.includes("tts");

  const patch = (next: Partial<WizardValues>) => setValues((cur) => ({ ...cur, ...next }));

  const selectTemplate = (tpl: Template) => {
    setTemplateId(tpl.id);
    patch(templateDefaults(tpl, meta.data));
    setErrors((cur) => ({ ...cur, template: undefined }));
  };

  // 模板載入後預選：網址帶的 ?template=（ID 或 key），否則第一個
  useEffect(() => {
    if (templateId || !templates.data || templates.data.length === 0) return;
    const wanted = params.get("template");
    const initial =
      templates.data.find((tpl) => tpl.id === wanted || tpl.key === wanted) ?? templates.data[0];
    if (initial) {
      setTemplateId(initial.id);
      setValues((cur) => ({ ...cur, ...templateDefaults(initial, meta.data) }));
    }
  }, [templates.data, templateId, params, meta.data]);

  // /meta 在選模板之後才載入時，把已不可用的聲音方式改回 native
  useEffect(() => {
    if (!meta.data) return;
    const modes = availableAudioModes(meta.data);
    setValues((cur) => (modes.includes(cur.audio_mode) ? cur : { ...cur, audio_mode: "native" }));
  }, [meta.data]);

  const estimateRequest = useMemo<EstimatePreviewRequest | null>(
    () =>
      template
        ? {
            template_id: template.id,
            target_duration_s: values.target_duration_s ?? null,
            ratio: values.ratio,
            audio_mode: values.audio_mode,
            draft_mode: values.draft_mode,
          }
        : null,
    [template, values.target_duration_s, values.ratio, values.audio_mode, values.draft_mode],
  );

  const derivedTitle = deriveTitle(values.topic);
  const displayTitle = values.title.trim() || derivedTitle || t("slate.untitled");
  const monitorImage = isQuick ? values.image_asset_ids?.[0] : values.product_asset_ids?.[0];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: FieldErrors = {};
    if (!template) nextErrors.template = t("slate.templateRequired");
    if (!values.topic.trim()) nextErrors.topic = t("studio.topicRequired");
    setErrors(nextErrors);
    if (!template || nextErrors.topic) {
      if (nextErrors.topic) topicRef.current?.focus();
      return;
    }
    setClapKey((k) => k + 1);
    setSubmitting(true);
    setSubmitError(null);
    const clapped = new Promise((resolve) => setTimeout(resolve, reducedMotion ? 0 : CLAP_MS));
    try {
      let jobId = createdId;
      if (!jobId) {
        const title = values.title.trim() || derivedTitle;
        const job = await api.createJob(buildJobCreate(template, { ...values, title }));
        jobId = job.id;
        setCreatedId(jobId);
      }
      await Promise.all([api.submitJob(jobId), clapped]);
      void navigate(`/jobs/${jobId}`);
    } catch (error) {
      setSubmitError(error);
      setTake((n) => n + 1);
      setSubmitting(false);
    }
  };

  if (!canCreate(user)) {
    return (
      <div className="vf-callout vf-callout-warn" role="alert">
        {t("common.forbidden")}
      </div>
    );
  }
  if (templates.isError) {
    return <ErrorResult error={templates.error} onRetry={() => void templates.refetch()} />;
  }

  const min = template?.min_duration_s ?? 5;
  const max = template?.max_duration_s ?? 30;
  const duration = values.target_duration_s ?? null;
  const locked = submitting || Boolean(createdId);

  return (
    <div className="vf-slate-page">
      <header className="vf-slate-head vf-rise">
        <span className="vf-label">{t("slate.kicker", { code: productionCode(today) })}</span>
        <h1 className="vf-serif">{t("slate.title")}</h1>
        <p>{t("slate.lead")}</p>
      </header>

      <div className="vf-slate-layout">
        <form
          className="vf-slate vf-rise-2"
          aria-label={t("slate.formLabel")}
          onSubmit={(e) => void submit(e)}
          noValidate
        >
          <div className="vf-slate-top" aria-hidden="true">
            <div
              key={clapKey}
              className={clapKey > 0 ? "vf-slate-stick vf-clapping" : "vf-slate-stick"}
            />
            <div className="vf-slate-hinge" />
            <div className="vf-slate-band" />
          </div>

          <div className="vf-slate-grid">
            <label className="vf-cell vf-cell-wide">
              <span className="vf-label">{t("slate.production")}</span>
              <input
                className="vf-slate-title vf-serif"
                value={values.title}
                maxLength={100}
                placeholder={derivedTitle || t("slate.titlePlaceholder")}
                onChange={(e) => patch({ title: e.target.value })}
                disabled={locked}
              />
            </label>

            <div className="vf-cell vf-cell-wide">
              <span className="vf-label" id="vf-type-label">
                {t("slate.type")}
              </span>
              {templates.isPending ? (
                <span className="vf-note">{t("studio.loading")}</span>
              ) : templates.data.length === 0 ? (
                <span className="vf-note">{t("wizard.noTemplates")}</span>
              ) : (
                <fieldset className="vf-tabs vf-slate-types" aria-labelledby="vf-type-label">
                  {templates.data.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      className="vf-tab"
                      aria-pressed={tpl.id === templateId}
                      onClick={() => selectTemplate(tpl)}
                      disabled={locked}
                    >
                      {tpl.name}
                    </button>
                  ))}
                </fieldset>
              )}
              {template && (
                <p className="vf-slate-type-meta">
                  <span>{template.description}</span>
                  <span className="vf-mono">
                    {t(`videoType.${template.video_type}`)} · {template.min_duration_s}–
                    {template.max_duration_s}S
                  </span>
                  {template.video_model === "video_long" && (
                    <span className="vf-slate-chip">{t("wizard.longShotTag")}</span>
                  )}
                </p>
              )}
              {errors.template && (
                <span className="vf-field-error" role="alert">
                  {errors.template}
                </span>
              )}
            </div>

            <div className="vf-cell">
              <span className="vf-label" id="vf-ratio-label">
                {t("slate.ratio")}
              </span>
              <fieldset className="vf-slate-ratios" aria-labelledby="vf-ratio-label">
                {RATIOS.map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    className="vf-tab vf-mono"
                    aria-pressed={values.ratio === ratio}
                    onClick={() => patch({ ratio })}
                    disabled={locked}
                  >
                    <RatioGlyph ratio={ratio} />
                    {ratio}
                  </button>
                ))}
              </fieldset>
            </div>

            <div className="vf-cell">
              <span className="vf-slate-duration-head">
                <label className="vf-label" htmlFor="vf-duration">
                  {t("slate.duration")}
                </label>
                <span className="vf-mono vf-slate-duration-value">
                  {duration === null ? t("slate.durationAuto") : durationLabel(duration)}
                </span>
              </span>
              <input
                id="vf-duration"
                type="range"
                className="vf-range"
                aria-label={t("wizard.fields.duration")}
                aria-valuetext={
                  duration === null
                    ? t("wizard.fields.durationHelp", { min, max })
                    : t("slate.durationSeconds", { count: duration })
                }
                min={min}
                max={max}
                step={max - min > 60 ? 5 : 1}
                value={duration ?? Math.round((min + max) / 2)}
                data-auto={duration === null}
                onChange={(e) => patch({ target_duration_s: Number(e.target.value) })}
                disabled={!template || locked}
              />
              <span className="vf-slate-duration-foot vf-mono">
                <span>{durationLabel(min)}</span>
                {duration === null ? (
                  <span>{t("slate.durationAutoHint")}</span>
                ) : (
                  <button
                    type="button"
                    className="vf-slate-reset"
                    onClick={() => patch({ target_duration_s: null })}
                    disabled={locked}
                  >
                    {t("slate.durationReset")}
                  </button>
                )}
                <span>{durationLabel(max)}</span>
              </span>
            </div>

            <div className="vf-cell">
              <span className="vf-label" id="vf-sound-label">
                {t("slate.sound")}
              </span>
              <fieldset className="vf-tabs" aria-labelledby="vf-sound-label">
                {audioModes.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className="vf-tab vf-slate-grow"
                    aria-pressed={values.audio_mode === mode}
                    onClick={() => patch({ audio_mode: mode })}
                    disabled={locked}
                  >
                    {t(`wizard.audioOption.${mode}`)}
                  </button>
                ))}
              </fieldset>
              {ttsFallback && (
                <span className="vf-note" data-testid="tts-unavailable">
                  {t("wizard.ttsUnavailable")}
                </span>
              )}
            </div>

            <div className="vf-cell">
              <span className="vf-label">{t("slate.options")}</span>
              <div className="vf-slate-option">
                <div>
                  <span id="vf-continuous-label">{t("wizard.fields.continuousShots")}</span>
                  <span className="vf-note">{t("wizard.fields.continuousShotsHelp")}</span>
                </div>
                <Toggle
                  checked={values.continuous_shots}
                  onChange={(on) => patch({ continuous_shots: on })}
                  labelledBy="vf-continuous-label"
                  disabled={locked}
                />
              </div>
            </div>

            <div className="vf-cell vf-cell-wide">
              <span className="vf-slate-count-head">
                <label className="vf-label" htmlFor="vf-topic">
                  {t("slate.story")}
                </label>
                <span className="vf-mono vf-muted">
                  {values.topic.length} / {MAX_TOPIC}
                </span>
              </span>
              <textarea
                id="vf-topic"
                ref={topicRef}
                className="vf-slate-story vf-serif"
                rows={3}
                maxLength={MAX_TOPIC}
                value={values.topic}
                placeholder={t("studio.topicPlaceholder")}
                aria-label={t("wizard.fields.topic")}
                aria-invalid={Boolean(errors.topic)}
                aria-describedby="vf-topic-help"
                onChange={(e) => {
                  patch({ topic: e.target.value });
                  if (errors.topic) setErrors((cur) => ({ ...cur, topic: undefined }));
                }}
                disabled={locked}
              />
              {errors.topic ? (
                <span className="vf-field-error" role="alert" id="vf-topic-help">
                  {errors.topic}
                </span>
              ) : (
                <span className="vf-note" id="vf-topic-help">
                  {t("wizard.fields.topicHelp")}
                </span>
              )}
            </div>

            <label className="vf-cell vf-cell-wide">
              <span className="vf-label">{t("slate.notes")}</span>
              <textarea
                className="vf-slate-input"
                rows={2}
                maxLength={2000}
                value={values.extra ?? ""}
                placeholder={t("slate.notesPlaceholder")}
                aria-label={t("wizard.fields.extra")}
                onChange={(e) => patch({ extra: e.target.value })}
                disabled={locked}
              />
            </label>

            {values.audio_mode === "native" && (
              <>
                <label className="vf-cell">
                  <span className="vf-label">{t("slate.voice")}</span>
                  <input
                    className="vf-slate-input"
                    maxLength={MAX_VOICE_TEXT}
                    value={values.voice_style ?? ""}
                    placeholder={t("wizard.fields.voiceStylePlaceholder")}
                    aria-label={t("wizard.fields.voiceStyle")}
                    onChange={(e) => patch({ voice_style: e.target.value })}
                    disabled={locked}
                  />
                </label>
                <label className="vf-cell">
                  <span className="vf-label">{t("slate.music")}</span>
                  <input
                    className="vf-slate-input"
                    maxLength={MAX_VOICE_TEXT}
                    value={values.music ?? ""}
                    placeholder={t("wizard.fields.musicPlaceholder")}
                    aria-label={t("wizard.fields.music")}
                    onChange={(e) => patch({ music: e.target.value })}
                    disabled={locked}
                  />
                </label>
                <div className="vf-cell vf-cell-wide">
                  <div className="vf-slate-option">
                    <div>
                      <span id="vf-consistent-label">{t("wizard.fields.consistentVoice")}</span>
                      <span className="vf-note">{t("wizard.fields.consistentVoiceHelp")}</span>
                    </div>
                    <Toggle
                      checked={values.consistent_voice ?? false}
                      onChange={(on) => patch({ consistent_voice: on })}
                      labelledBy="vf-consistent-label"
                      disabled={locked}
                    />
                  </div>
                </div>
              </>
            )}

            <div className="vf-cell vf-cell-wide">
              <span className="vf-label">{t("slate.references")}</span>
              <div className="vf-slate-refs">
                {isQuick ? (
                  <div className="vf-slate-ref">
                    <span className="vf-mono vf-muted">{t("wizard.fields.firstFrame")}</span>
                    <AssetPicker
                      kinds={["image", "product"]}
                      uploadKinds={["image", "product"]}
                      buttonText={t("wizard.fields.pickFirstFrame")}
                      value={values.image_asset_ids ?? []}
                      onChange={(ids) => patch({ image_asset_ids: ids })}
                      disabled={locked}
                    />
                  </div>
                ) : (
                  <div className="vf-slate-ref">
                    <span className="vf-mono vf-muted">{t("wizard.fields.products")}</span>
                    <AssetPicker
                      kinds={["product", "image"]}
                      uploadKinds={["product", "image"]}
                      multiple
                      buttonText={t("wizard.fields.pickProducts")}
                      value={values.product_asset_ids ?? []}
                      onChange={(ids) => patch({ product_asset_ids: ids })}
                      disabled={locked}
                    />
                  </div>
                )}
                <div className="vf-slate-ref">
                  <span className="vf-mono vf-muted">{t("wizard.fields.logo")}</span>
                  <AssetPicker
                    kinds={["logo"]}
                    uploadKinds={["logo"]}
                    buttonText={t("wizard.fields.pickLogo")}
                    value={values.logo_asset_ids ?? []}
                    onChange={(ids) => patch({ logo_asset_ids: ids })}
                    disabled={locked}
                  />
                </div>
                <div className="vf-slate-ref">
                  <span className="vf-mono vf-muted">{t("wizard.fields.bgm")}</span>
                  <AssetPicker
                    kinds={["bgm"]}
                    uploadKinds={["bgm"]}
                    buttonText={t("wizard.fields.pickBgm")}
                    value={values.bgm_asset_ids ?? []}
                    onChange={(ids) => patch({ bgm_asset_ids: ids })}
                    disabled={locked}
                  />
                </div>
              </div>
            </div>

            {Boolean(submitError) && (
              <div className="vf-cell vf-cell-wide">
                <ErrorAlert error={submitError} />
              </div>
            )}

            <div className="vf-cell vf-cell-wide vf-slate-foot">
              <span className="vf-mono vf-slate-roll">
                {t("slate.roll", { take, date: slateDate(today) })}
              </span>
              <button
                type="submit"
                className="vf-btn vf-btn-primary vf-slate-go"
                aria-busy={submitting}
                disabled={submitting}
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
          </div>
        </form>

        <aside className="vf-slate-aside vf-rise-3" aria-label={t("slate.aside")}>
          <Monitor
            ratio={values.ratio}
            resolution={template?.resolution}
            imageId={monitorImage}
            title={displayTitle}
          />
          <BudgetCard
            request={estimateRequest}
            draftMode={values.draft_mode}
            onDraftMode={(on) => patch({ draft_mode: on })}
            disabled={locked}
          />
          <p className="vf-note">{t("slate.writeNote")}</p>
        </aside>
      </div>
    </div>
  );
}
