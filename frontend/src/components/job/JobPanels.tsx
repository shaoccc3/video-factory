import { DownloadOutlined, RedoOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Popconfirm,
  Row,
  Table,
  Tag,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import { assetContentUrl, assetDownloadUrl, assetThumbnailUrl } from "../../api/client";
import { useCalls, useJobCommand } from "../../api/hooks";
import {
  CHECKLIST_KEYS,
  type GenerationCall,
  type JobDetail,
  type Review,
  type Scene,
} from "../../api/types";
import { formatCny, formatDateTime, formatSeconds } from "../../utils/format";
import { ErrorAlert } from "../ErrorResult";
import { SceneStatusTag } from "../StatusTag";
import { errorCategory } from "./JobErrorAlert";

function SceneCard({
  job,
  scene,
  canRegenerate,
}: {
  job: JobDetail;
  scene: Scene;
  canRegenerate: boolean;
}) {
  const { t } = useTranslation();
  const command = useJobCommand(job.id);
  const regenerate = (target: "keyframe" | "video") =>
    command.mutate({ type: "regenerate_scene", sceneId: scene.id, target });

  return (
    <Card
      size="small"
      id={`scene-${scene.index}`}
      data-testid={`scene-preview-${scene.index}`}
      title={
        <Flex gap={8} align="center">
          <span>{t("storyboard.sceneTitle", { index: scene.index + 1 })}</span>
          <SceneStatusTag status={scene.status} />
          {scene.is_draft && <Tag color="orange">{t("scene.draft")}</Tag>}
        </Flex>
      }
      extra={
        <Typography.Text type="secondary">
          {formatSeconds(scene.duration_s)}
          {scene.attempt > 1 ? ` · ${t("scene.attempt", { count: scene.attempt })}` : ""}
        </Typography.Text>
      }
      cover={
        scene.video_asset_id ? (
          // biome-ignore lint/a11y/useMediaCaption: 生成片段的字幕燒在畫面內，另有獨立字幕檔
          <video
            src={assetContentUrl(scene.video_asset_id)}
            controls
            preload="metadata"
            poster={assetThumbnailUrl(scene.video_asset_id)}
            style={{ width: "100%", maxHeight: 320, background: "#000" }}
          />
        ) : undefined
      }
    >
      <Typography.Paragraph ellipsis={{ rows: 2, expandable: true }} style={{ marginBottom: 4 }}>
        {scene.narration || scene.visual_prompt}
      </Typography.Paragraph>
      {(scene.speaker || scene.sound) && (
        <Flex vertical gap={2} style={{ marginBottom: 8 }}>
          {scene.speaker && (
            <Typography.Text type="secondary" data-testid={`scene-speaker-${scene.index}`}>
              {t("scene.speaker")}：{scene.speaker}
            </Typography.Text>
          )}
          {scene.sound && (
            <Typography.Text type="secondary" data-testid={`scene-sound-${scene.index}`}>
              {t("scene.sound")}：{scene.sound}
            </Typography.Text>
          )}
        </Flex>
      )}
      {scene.error_message && (
        <Alert
          type={errorCategory(scene.error_kind) === "system" ? "error" : "warning"}
          showIcon
          style={{ marginBottom: 8 }}
          title={scene.error_kind ? t(`errorKind.${scene.error_kind}`) : t("jobError.system.title")}
          description={scene.error_message}
        />
      )}
      <ErrorAlert error={command.error} />
      {canRegenerate && (
        <Flex gap={8} wrap>
          <Popconfirm
            title={t("scene.regenerateConfirm")}
            okText={t("common.confirm")}
            cancelText={t("common.cancel")}
            onConfirm={() => regenerate("video")}
          >
            <Button size="small" icon={<RedoOutlined />} loading={command.isPending}>
              {t("scene.regenerateVideo")}
            </Button>
          </Popconfirm>
          {scene.needs_first_frame && (
            <Popconfirm
              title={t("scene.regenerateConfirm")}
              okText={t("common.confirm")}
              cancelText={t("common.cancel")}
              onConfirm={() => regenerate("keyframe")}
            >
              <Button size="small" loading={command.isPending}>
                {t("scene.regenerateKeyframe")}
              </Button>
            </Popconfirm>
          )}
        </Flex>
      )}
    </Card>
  );
}

export function ScenePreviews({ job }: { job: JobDetail }) {
  const { t } = useTranslation();
  const canRegenerate = job.allowed_actions.includes("regenerate_scene");
  return (
    <Card title={t("scene.title")} style={{ marginBottom: 16 }}>
      {job.scenes.length === 0 ? (
        <Empty description={t("scene.empty")} />
      ) : (
        <Row gutter={[16, 16]}>
          {job.scenes.map((scene) => (
            <Col key={scene.id} xs={24} sm={12} lg={8} xxl={6}>
              <SceneCard job={job} scene={scene} canRegenerate={canRegenerate} />
            </Col>
          ))}
        </Row>
      )}
    </Card>
  );
}

export function FinalPreview({ job }: { job: JobDetail }) {
  const { t } = useTranslation();
  if (!job.final_asset_id) return null;
  const canDownload = job.allowed_actions.includes("download");
  return (
    <Card
      title={t("final.title")}
      style={{ marginBottom: 16 }}
      extra={
        canDownload ? (
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            href={assetDownloadUrl(job.final_asset_id)}
            data-testid="download-final"
          >
            {t("final.download")}
          </Button>
        ) : (
          <Typography.Text type="secondary">{t("final.downloadLocked")}</Typography.Text>
        )
      }
    >
      <Flex gap={16} wrap align="flex-start">
        {/* biome-ignore lint/a11y/useMediaCaption: 成片字幕已燒錄進畫面 */}
        <video
          data-testid="final-video"
          src={assetContentUrl(job.final_asset_id)}
          poster={job.cover_asset_id ? assetContentUrl(job.cover_asset_id) : undefined}
          controls
          preload="metadata"
          style={{ maxWidth: "100%", maxHeight: 560, background: "#000" }}
        />
        {job.cover_asset_id && (
          <div>
            <Typography.Text type="secondary">{t("final.cover")}</Typography.Text>
            <br />
            <img
              src={assetContentUrl(job.cover_asset_id)}
              alt={t("final.cover")}
              style={{ maxWidth: 200, maxHeight: 360, marginTop: 4 }}
            />
          </div>
        )}
      </Flex>
    </Card>
  );
}

export function CallsTable({ job }: { job: JobDetail }) {
  const { t, i18n } = useTranslation();
  const calls = useCalls(job.id);
  const sceneIndex = new Map(job.scenes.map((s) => [s.id, s.index]));
  const total = (calls.data ?? []).reduce((sum, c) => sum + c.cost_cny, 0);
  return (
    <Card
      title={t("calls.title")}
      style={{ marginBottom: 16 }}
      extra={
        <Typography.Text>
          {t("calls.total")}: {formatCny(total)}
        </Typography.Text>
      }
    >
      <ErrorAlert error={calls.error} />
      <Table<GenerationCall>
        size="small"
        rowKey="id"
        loading={calls.isFetching}
        dataSource={calls.data ?? []}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: 900 }}
        columns={[
          {
            title: t("calls.startedAt"),
            dataIndex: "started_at",
            render: (v: string) => formatDateTime(v, i18n.language),
          },
          { title: t("calls.provider"), dataIndex: "provider" },
          { title: t("calls.model"), dataIndex: "model_id" },
          {
            title: t("calls.scene"),
            dataIndex: "scene_id",
            render: (v: string | null) => {
              const index = v ? sceneIndex.get(v) : undefined;
              return index === undefined ? "—" : `#${index + 1}`;
            },
          },
          {
            title: t("calls.status"),
            dataIndex: "status",
            render: (status: string, call) => (
              <>
                <Tag>{status}</Tag>
                {call.error_kind && (
                  <Tag color={call.error_kind === "moderation" ? "orange" : "red"}>
                    {t(`errorKind.${call.error_kind}`)}
                    {call.error_code ? ` (${call.error_code})` : ""}
                  </Tag>
                )}
              </>
            ),
          },
          { title: t("calls.attempt"), dataIndex: "attempt", align: "right" },
          {
            title: t("calls.duration"),
            dataIndex: "duration_ms",
            align: "right",
            render: (v: number | null) => (v === null ? "—" : `${(v / 1000).toFixed(1)}s`),
          },
          {
            title: t("calls.cost"),
            dataIndex: "cost_cny",
            align: "right",
            render: (v: number) => formatCny(v),
          },
        ]}
      />
    </Card>
  );
}

export function ReviewHistory({ reviews }: { reviews: Review[] }) {
  const { t, i18n } = useTranslation();
  if (reviews.length === 0) return null;
  return (
    <Card title={t("review.history")} style={{ marginBottom: 16 }}>
      <Table<Review>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={reviews}
        columns={[
          {
            title: t("review.time"),
            dataIndex: "created_at",
            render: (v: string) => formatDateTime(v, i18n.language),
          },
          { title: t("review.reviewer"), dataIndex: "reviewer_name" },
          {
            title: t("review.decision"),
            dataIndex: "decision",
            render: (d: Review["decision"]) => (
              <Tag color={d === "approved" ? "success" : "orange"}>{t(`review.${d}`)}</Tag>
            ),
          },
          {
            title: t("review.checklistTitle"),
            dataIndex: "checklist",
            render: (checklist: Record<string, boolean>) => (
              <Flex gap={4} wrap>
                {CHECKLIST_KEYS.map((key) => (
                  <Tag key={key} color={checklist[key] ? "success" : "default"}>
                    {t(`review.checklist.${key}`)}
                  </Tag>
                ))}
              </Flex>
            ),
          },
          { title: t("review.reason"), dataIndex: "reason", render: (v: string) => v || "—" },
        ]}
      />
    </Card>
  );
}
