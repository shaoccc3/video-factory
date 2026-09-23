import {
  AuditOutlined,
  CaretRightOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  StopOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Flex,
  Popconfirm,
  Result,
  Spin,
  Tag,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { type JobCommand, useJob, useJobCommand } from "../api/hooks";
import { useJobEvents } from "../api/sse";
import type { JobDetail } from "../api/types";
import { ErrorAlert, ErrorResult } from "../components/ErrorResult";
import { JobErrorAlert } from "../components/job/JobErrorAlert";
import {
  CallsTable,
  FinalPreview,
  ReviewHistory,
  ScenePreviews,
} from "../components/job/JobPanels";
import { StoryboardEditor } from "../components/job/StoryboardEditor";
import { JobStatusTag } from "../components/StatusTag";
import { formatCny, formatDateTime } from "../utils/format";
import { JobProgressBar } from "./JobsPage";

const STORYBOARD_STATUSES = new Set(["storyboard_ready", "rejected"]);

function JobActions({ job }: { job: JobDetail }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const command = useJobCommand(job.id);
  const actions = new Set(job.allowed_actions);
  const inStoryboard = STORYBOARD_STATUSES.has(job.status);
  const run = (c: JobCommand) => command.mutate(c);
  const pendingType = command.isPending ? command.variables?.type : undefined;

  return (
    <>
      <Flex gap={8} wrap>
        {actions.has("submit") && (
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            loading={pendingType === "submit"}
            onClick={() => run({ type: "submit" })}
          >
            {t("actions.submit")}
          </Button>
        )}
        {actions.has("regenerate_script") && !inStoryboard && (
          <Button
            icon={<ReloadOutlined />}
            loading={pendingType === "regenerate_script"}
            onClick={() => run({ type: "regenerate_script" })}
          >
            {t("storyboard.regenerateScript")}
          </Button>
        )}
        {actions.has("render_final") && (
          <Popconfirm
            title={t("actions.renderFinalConfirm")}
            okText={t("common.confirm")}
            cancelText={t("common.cancel")}
            onConfirm={() => run({ type: "render_final" })}
          >
            <Button type="primary" loading={pendingType === "render_final"}>
              {t("actions.renderFinal")}
            </Button>
          </Popconfirm>
        )}
        {actions.has("resume") && (
          <Button
            icon={<CaretRightOutlined />}
            loading={pendingType === "resume"}
            onClick={() => run({ type: "resume" })}
          >
            {t("actions.resume")}
          </Button>
        )}
        {actions.has("review") && (
          <Button icon={<AuditOutlined />} onClick={() => void navigate(`/reviews/${job.id}`)}>
            {t("actions.review")}
          </Button>
        )}
        {actions.has("cancel") && (
          <Popconfirm
            title={t("actions.cancelConfirm")}
            okText={t("common.confirm")}
            cancelText={t("common.cancel")}
            onConfirm={() => run({ type: "cancel" })}
          >
            <Button danger icon={<StopOutlined />} loading={pendingType === "cancel"}>
              {t("actions.cancel")}
            </Button>
          </Popconfirm>
        )}
      </Flex>
      <div style={{ marginTop: command.error ? 12 : 0 }}>
        <ErrorAlert error={command.error} />
      </div>
    </>
  );
}

export function JobDetailPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const job = useJob(id);
  useJobEvents(id);

  if (job.isPending) {
    return (
      <Flex justify="center" style={{ padding: 48 }}>
        <Spin size="large" />
      </Flex>
    );
  }
  if (job.isError) {
    return <ErrorResult error={job.error} onRetry={() => void job.refetch()} />;
  }

  const data = job.data;
  const inStoryboard = STORYBOARD_STATUSES.has(data.status) && data.scenes.length > 0;

  return (
    <>
      <Flex justify="space-between" align="flex-start" wrap gap={16} style={{ marginBottom: 16 }}>
        <div>
          <Typography.Text type="secondary">
            <Link to="/jobs">{t("jobs.title")}</Link> /
          </Typography.Text>
          <Flex align="center" gap={8}>
            <Typography.Title level={3} style={{ margin: 0 }}>
              {data.title}
            </Typography.Title>
            <span data-testid="job-status" data-status={data.status}>
              <JobStatusTag status={data.status} />
            </span>
            {data.draft_mode && <Tag color="orange">{t("jobDetail.draftMode")}</Tag>}
          </Flex>
        </div>
        <JobActions job={data} />
      </Flex>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Descriptions
          size="small"
          column={{ xs: 1, sm: 2, lg: 4 }}
          items={[
            {
              key: "type",
              label: t("jobs.columns.type"),
              children: t(`videoType.${data.video_type}`),
            },
            { key: "template", label: t("jobs.columns.template"), children: data.template_name },
            { key: "ratio", label: t("wizard.fields.ratio"), children: data.ratio },
            {
              key: "audio",
              label: t("wizard.fields.audioMode"),
              children: t(`audioMode.${data.options.audio_mode}`),
            },
            { key: "owner", label: t("jobs.columns.owner"), children: data.owner_name },
            {
              key: "created",
              label: t("jobs.columns.createdAt"),
              children: formatDateTime(data.created_at, i18n.language),
            },
            {
              key: "cost",
              label: t("jobDetail.cost"),
              children: `${formatCny(data.actual_cost_cny)} / ${formatCny(data.estimated_cost_cny)}`,
            },
            {
              key: "progress",
              label: t("jobs.columns.progress"),
              children: <JobProgressBar job={data} />,
            },
            {
              key: "topic",
              label: t("wizard.fields.topic"),
              span: "filled",
              children: data.inputs.topic,
            },
            ...(data.inputs.extra
              ? [
                  {
                    key: "extra",
                    label: t("wizard.fields.extra"),
                    span: "filled" as const,
                    children: data.inputs.extra,
                  },
                ]
              : []),
          ]}
        />
      </Card>

      {data.warnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title={t("jobDetail.warnings")}
          description={
            <ul style={{ margin: 0, paddingInlineStart: 20 }}>
              {data.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          }
        />
      )}

      <JobErrorAlert job={data} />

      {data.status === "draft" && data.scenes.length === 0 && (
        <Result status="info" title={t("jobDetail.draftHint")} />
      )}
      {data.status === "scripting" && (
        <Result icon={<Spin size="large" />} title={t("jobDetail.scripting")} />
      )}

      {inStoryboard ? (
        <div style={{ marginBottom: 16 }}>
          <StoryboardEditor job={data} />
        </div>
      ) : (
        <>
          <FinalPreview job={data} />
          {data.scenes.length > 0 && <ScenePreviews job={data} />}
        </>
      )}

      <ReviewHistory reviews={data.reviews} />
      <CallsTable job={data} />
    </>
  );
}
