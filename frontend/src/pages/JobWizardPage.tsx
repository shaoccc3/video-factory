import { CheckCircleFilled } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Row,
  Segmented,
  Select,
  Spin,
  Steps,
  Switch,
  Tag,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { api } from "../api/client";
import { useMeta, useTemplates } from "../api/hooks";
import {
  type AudioMode,
  type JobCreate,
  type PlatformMeta,
  RATIOS,
  type Ratio,
  type Template,
} from "../api/types";
import { AssetPicker } from "../components/AssetPicker";
import { ErrorAlert, ErrorResult } from "../components/ErrorResult";

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

/** 精靈裡聲音方式的顯示順序：原生聲音優先 */
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

/** 把精靈表單轉成 JobCreate（只送契約內的欄位） */
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

function TemplateCard({
  template,
  selected,
  onSelect,
}: {
  template: Template;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card
      hoverable
      onClick={onSelect}
      role="radio"
      aria-checked={selected}
      aria-label={template.name}
      style={{ borderColor: selected ? "#1677ff" : undefined, height: "100%" }}
      title={
        <Flex justify="space-between" align="center">
          <span>{template.name}</span>
          {selected && <CheckCircleFilled style={{ color: "#1677ff" }} />}
        </Flex>
      }
    >
      <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }}>
        {template.description}
      </Typography.Paragraph>
      <Flex gap={4} wrap>
        <Tag color="blue">{t(`videoType.${template.video_type}`)}</Tag>
        <Tag>{template.ratio}</Tag>
        <Tag>
          {template.min_duration_s}–{template.max_duration_s}s
        </Tag>
        <Tag>{t(`audioMode.${template.audio_mode}`)}</Tag>
        {template.video_model === "video_long" && (
          <Tag color="purple">{t("wizard.longShotTag")}</Tag>
        )}
      </Flex>
    </Card>
  );
}

export function JobWizardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const templates = useTemplates();
  const meta = useMeta();
  const [form] = Form.useForm<WizardValues>();
  const [step, setStep] = useState(0);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);

  const template = templates.data?.find((tpl) => tpl.id === templateId) ?? null;
  const isQuick = template?.video_type === "quick";
  const audioModes = availableAudioModes(meta.data);
  const audioMode = Form.useWatch("audio_mode", { form, preserve: true }) as AudioMode | undefined;
  /** 模板預設 TTS，但目前區域不提供 */
  const ttsFallback = template?.audio_mode === "tts" && !audioModes.includes("tts");

  const selectTemplate = (tpl: Template) => {
    setTemplateId(tpl.id);
    form.setFieldsValue({
      ratio: tpl.ratio,
      audio_mode: defaultAudioMode(tpl, meta.data),
      target_duration_s: null,
      draft_mode: false,
      continuous_shots: false,
      voice_style: "",
      music: "",
      consistent_voice: false,
    });
  };

  // /meta 在選模板之後才載入時，把已不可用的聲音方式改回 native
  useEffect(() => {
    if (!meta.data || !template) return;
    const current = form.getFieldValue("audio_mode") as AudioMode | undefined;
    if (current && !availableAudioModes(meta.data).includes(current)) {
      form.setFieldsValue({ audio_mode: "native" });
    }
  }, [meta.data, template, form]);

  const next = async () => {
    if (step === 0) {
      if (template) setStep(1);
      return;
    }
    try {
      await form.validateFields();
      setStep((s) => s + 1);
    } catch {
      // 校驗錯誤已顯示在欄位下方
    }
  };

  const submit = async () => {
    if (!template) return;
    const values = form.getFieldsValue(true) as WizardValues;
    setSubmitting(true);
    setSubmitError(null);
    try {
      let jobId = createdId;
      if (!jobId) {
        const job = await api.createJob(buildJobCreate(template, values));
        jobId = job.id;
        setCreatedId(jobId);
      }
      await api.submitJob(jobId);
      void navigate(`/jobs/${jobId}`);
    } catch (error) {
      setSubmitError(error);
    } finally {
      setSubmitting(false);
    }
  };

  if (templates.isError) {
    return <ErrorResult error={templates.error} onRetry={() => void templates.refetch()} />;
  }

  const values = form.getFieldsValue(true) as Partial<WizardValues>;

  return (
    <>
      <Typography.Title level={3}>{t("wizard.title")}</Typography.Title>
      <Steps
        current={step}
        style={{ marginBottom: 24 }}
        items={[
          { title: t("wizard.steps.template") },
          { title: t("wizard.steps.inputs") },
          { title: t("wizard.steps.settings") },
          { title: t("wizard.steps.confirm") },
        ]}
      />

      {step === 0 &&
        (templates.isPending ? (
          <Spin />
        ) : templates.data.length === 0 ? (
          <Empty description={t("wizard.noTemplates")} />
        ) : (
          <Row gutter={[16, 16]} role="radiogroup" aria-label={t("wizard.steps.template")}>
            {templates.data.map((tpl) => (
              <Col key={tpl.id} xs={24} sm={12} lg={8}>
                <TemplateCard
                  template={tpl}
                  selected={tpl.id === templateId}
                  onSelect={() => selectTemplate(tpl)}
                />
              </Col>
            ))}
          </Row>
        ))}

      <Form<WizardValues> form={form} layout="vertical" style={{ maxWidth: 760 }}>
        {step === 1 && template && (
          <>
            <Form.Item
              name="title"
              label={t("wizard.fields.title")}
              rules={[
                { required: true, whitespace: true, message: t("wizard.fields.titleRequired") },
              ]}
            >
              <Input maxLength={100} />
            </Form.Item>
            <Form.Item
              name="topic"
              label={t("wizard.fields.topic")}
              rules={[
                { required: true, whitespace: true, message: t("wizard.fields.topicRequired") },
              ]}
              extra={t("wizard.fields.topicHelp")}
            >
              <Input.TextArea rows={3} maxLength={1000} showCount />
            </Form.Item>
            <Form.Item name="extra" label={t("wizard.fields.extra")}>
              <Input.TextArea rows={2} maxLength={2000} />
            </Form.Item>
            {isQuick ? (
              <Form.Item name="image_asset_ids" label={t("wizard.fields.firstFrame")}>
                <AssetPicker
                  kinds={["image", "product"]}
                  uploadKinds={["image", "product"]}
                  buttonText={t("wizard.fields.pickFirstFrame")}
                />
              </Form.Item>
            ) : (
              <Form.Item name="product_asset_ids" label={t("wizard.fields.products")}>
                <AssetPicker
                  kinds={["product", "image"]}
                  uploadKinds={["product", "image"]}
                  multiple
                  buttonText={t("wizard.fields.pickProducts")}
                />
              </Form.Item>
            )}
            <Form.Item name="logo_asset_ids" label={t("wizard.fields.logo")}>
              <AssetPicker
                kinds={["logo"]}
                uploadKinds={["logo"]}
                buttonText={t("wizard.fields.pickLogo")}
              />
            </Form.Item>
            <Form.Item name="bgm_asset_ids" label={t("wizard.fields.bgm")}>
              <AssetPicker
                kinds={["bgm"]}
                uploadKinds={["bgm"]}
                buttonText={t("wizard.fields.pickBgm")}
              />
            </Form.Item>
          </>
        )}

        {step === 2 && template && (
          <>
            <Form.Item name="ratio" label={t("wizard.fields.ratio")} rules={[{ required: true }]}>
              <Segmented options={[...RATIOS]} />
            </Form.Item>
            <Form.Item
              name="target_duration_s"
              label={t("wizard.fields.duration")}
              extra={t("wizard.fields.durationHelp", {
                min: template.min_duration_s,
                max: template.max_duration_s,
              })}
            >
              <InputNumber
                min={template.min_duration_s}
                max={template.max_duration_s}
                suffix="s"
                style={{ width: 160 }}
              />
            </Form.Item>
            <Form.Item
              name="audio_mode"
              label={t("wizard.fields.audioMode")}
              rules={[{ required: true }]}
            >
              <Select
                style={{ width: 240 }}
                options={audioModes.map((m) => ({ value: m, label: t(`wizard.audioOption.${m}`) }))}
              />
            </Form.Item>
            {ttsFallback && (
              <Alert
                type="info"
                showIcon
                title={t("wizard.ttsUnavailable")}
                style={{ marginBottom: 16 }}
                data-testid="tts-unavailable"
              />
            )}
            {audioMode === "native" && (
              <>
                <Form.Item name="voice_style" label={t("wizard.fields.voiceStyle")}>
                  <Input
                    maxLength={MAX_VOICE_TEXT}
                    showCount
                    placeholder={t("wizard.fields.voiceStylePlaceholder")}
                  />
                </Form.Item>
                <Form.Item name="music" label={t("wizard.fields.music")}>
                  <Input
                    maxLength={MAX_VOICE_TEXT}
                    showCount
                    placeholder={t("wizard.fields.musicPlaceholder")}
                  />
                </Form.Item>
                <Form.Item
                  name="consistent_voice"
                  label={t("wizard.fields.consistentVoice")}
                  valuePropName="checked"
                  tooltip={t("wizard.fields.consistentVoiceHelp")}
                >
                  <Switch />
                </Form.Item>
              </>
            )}
            <Form.Item
              name="draft_mode"
              label={t("wizard.fields.draftMode")}
              valuePropName="checked"
              extra={t("wizard.fields.draftModeHelp")}
            >
              <Switch />
            </Form.Item>
            <Form.Item
              name="continuous_shots"
              label={t("wizard.fields.continuousShots")}
              valuePropName="checked"
              extra={t("wizard.fields.continuousShotsHelp")}
            >
              <Switch />
            </Form.Item>
          </>
        )}
      </Form>

      {step === 3 && template && (
        <>
          <Descriptions
            bordered
            column={1}
            size="small"
            style={{ maxWidth: 760, marginBottom: 16 }}
            items={[
              { key: "template", label: t("wizard.steps.template"), children: template.name },
              { key: "title", label: t("wizard.fields.title"), children: values.title },
              { key: "topic", label: t("wizard.fields.topic"), children: values.topic },
              { key: "extra", label: t("wizard.fields.extra"), children: values.extra || "—" },
              {
                key: "assets",
                label: t("wizard.fields.assets"),
                children: t("wizard.assetCount", {
                  count:
                    (values.product_asset_ids?.length ?? 0) +
                    (values.image_asset_ids?.length ?? 0) +
                    (values.logo_asset_ids?.length ?? 0) +
                    (values.bgm_asset_ids?.length ?? 0),
                }),
              },
              { key: "ratio", label: t("wizard.fields.ratio"), children: values.ratio },
              {
                key: "duration",
                label: t("wizard.fields.duration"),
                children: values.target_duration_s
                  ? `${values.target_duration_s}s`
                  : t("wizard.durationAuto"),
              },
              {
                key: "audio",
                label: t("wizard.fields.audioMode"),
                children: values.audio_mode ? t(`audioMode.${values.audio_mode}`) : "—",
              },
              ...(values.audio_mode === "native"
                ? [
                    {
                      key: "voice_style",
                      label: t("wizard.fields.voiceStyle"),
                      children: values.voice_style?.trim() || "—",
                    },
                    {
                      key: "music",
                      label: t("wizard.fields.music"),
                      children: values.music?.trim() || "—",
                    },
                    {
                      key: "consistent_voice",
                      label: t("wizard.fields.consistentVoice"),
                      children: values.consistent_voice ? t("common.yes") : t("common.no"),
                    },
                  ]
                : []),
              {
                key: "draft",
                label: t("wizard.fields.draftMode"),
                children: values.draft_mode ? t("common.yes") : t("common.no"),
              },
              {
                key: "continuous",
                label: t("wizard.fields.continuousShots"),
                children: values.continuous_shots ? t("common.yes") : t("common.no"),
              },
            ]}
          />
          <Alert
            type="info"
            showIcon
            title={t("wizard.submitHint")}
            style={{ maxWidth: 760, marginBottom: 16 }}
          />
          <ErrorAlert error={submitError} />
        </>
      )}

      <Flex gap={8} style={{ marginTop: 16 }}>
        {step > 0 && (
          <Button onClick={() => setStep((s) => s - 1)} disabled={submitting || Boolean(createdId)}>
            {t("wizard.prev")}
          </Button>
        )}
        {step < 3 ? (
          <Button type="primary" onClick={() => void next()} disabled={step === 0 && !template}>
            {t("wizard.next")}
          </Button>
        ) : (
          <Button type="primary" loading={submitting} onClick={() => void submit()}>
            {t("wizard.submit")}
          </Button>
        )}
      </Flex>
    </>
  );
}
