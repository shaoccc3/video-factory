import { CheckOutlined, ReloadOutlined, SaveOutlined } from "@ant-design/icons";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  Flex,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Space,
  Switch,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../api/client";
import { useEstimate, useJobCommand } from "../../api/hooks";
import type { JobDetail, Scene, SceneUpdate } from "../../api/types";
import { formatSeconds } from "../../utils/format";
import { AssetPicker } from "../AssetPicker";
import { CostEstimatePanel } from "../CostEstimatePanel";
import { ErrorAlert } from "../ErrorResult";

interface SceneFormValues {
  narration: string;
  visual_prompt: string;
  shot_type: string;
  camera_move: string;
  duration_s: number;
  screen_text: string;
  needs_first_frame: boolean;
  /** 只有 needs_first_frame 時才掛載這個欄位 */
  first_frame_asset_ids?: string[];
}

function toFormValues(scene: Scene): SceneFormValues {
  return {
    narration: scene.narration,
    visual_prompt: scene.visual_prompt,
    shot_type: scene.shot_type,
    camera_move: scene.camera_move,
    duration_s: scene.duration_s,
    screen_text: scene.screen_text,
    needs_first_frame: scene.needs_first_frame,
    first_frame_asset_ids: scene.first_frame_asset_id ? [scene.first_frame_asset_id] : [],
  };
}

/** 只送出有改動的欄位 */
export function sceneDiff(scene: Scene, values: SceneFormValues): SceneUpdate {
  const diff: SceneUpdate = {};
  if (values.narration !== scene.narration) diff.narration = values.narration;
  if (values.visual_prompt !== scene.visual_prompt) diff.visual_prompt = values.visual_prompt;
  if (values.shot_type !== scene.shot_type) diff.shot_type = values.shot_type;
  if (values.camera_move !== scene.camera_move) diff.camera_move = values.camera_move;
  if (values.duration_s !== scene.duration_s) diff.duration_s = values.duration_s;
  if (values.screen_text !== scene.screen_text) diff.screen_text = values.screen_text;
  if (values.needs_first_frame !== scene.needs_first_frame) {
    diff.needs_first_frame = values.needs_first_frame;
  }
  if (values.first_frame_asset_ids !== undefined) {
    const firstFrame = values.first_frame_asset_ids[0] ?? null;
    if (firstFrame !== scene.first_frame_asset_id) diff.first_frame_asset_id = firstFrame;
  }
  return diff;
}

function SceneEditorCard({
  job,
  scene,
  editable,
}: {
  job: JobDetail;
  scene: Scene;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<SceneFormValues>();
  const command = useJobCommand(job.id);
  const needsFirstFrame = Form.useWatch("needs_first_frame", form) ?? scene.needs_first_frame;

  const save = (values: SceneFormValues) => {
    const body = sceneDiff(scene, values);
    if (Object.keys(body).length === 0) return;
    command.mutate(
      { type: "update_scene", sceneId: scene.id, body },
      { onSuccess: () => void message.success(t("storyboard.saved")) },
    );
  };

  return (
    <Card
      size="small"
      title={t("storyboard.sceneTitle", { index: scene.index + 1 })}
      extra={<Typography.Text type="secondary">{formatSeconds(scene.duration_s)}</Typography.Text>}
      data-testid={`scene-editor-${scene.index}`}
    >
      <ErrorAlert error={command.error} />
      <Form<SceneFormValues>
        form={form}
        layout="vertical"
        initialValues={toFormValues(scene)}
        disabled={!editable}
        onFinish={save}
      >
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="narration" label={t("storyboard.narration")}>
              <Input.TextArea rows={3} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="visual_prompt"
              label={t("storyboard.visualPrompt")}
              rules={[
                { required: true, whitespace: true, message: t("storyboard.visualRequired") },
              ]}
            >
              <Input.TextArea rows={3} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="shot_type" label={t("storyboard.shotType")}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="camera_move" label={t("storyboard.cameraMove")}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item
              name="duration_s"
              label={t("storyboard.duration")}
              rules={[{ required: true }]}
            >
              <InputNumber min={1} max={60} step={1} suffix="s" style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item
              name="needs_first_frame"
              label={t("storyboard.needsFirstFrame")}
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="screen_text" label={t("storyboard.screenText")}>
              <Input />
            </Form.Item>
          </Col>
          {needsFirstFrame && (
            <Col xs={24} md={12}>
              <Form.Item name="first_frame_asset_ids" label={t("storyboard.firstFrame")}>
                <AssetPicker
                  kinds={["product", "image", "keyframe"]}
                  uploadKinds={["product", "image"]}
                  buttonText={t("storyboard.replaceFirstFrame")}
                  disabled={!editable}
                />
              </Form.Item>
            </Col>
          )}
        </Row>
        {editable && (
          <Flex justify="flex-end">
            <Button htmlType="submit" icon={<SaveOutlined />} loading={command.isPending}>
              {t("storyboard.save")}
            </Button>
          </Flex>
        )}
      </Form>
    </Card>
  );
}

/** 分鏡確認：逐條編輯、成本預估、確認生成；按鈕只看 allowed_actions */
export function StoryboardEditor({ job }: { job: JobDetail }) {
  const { t } = useTranslation();
  const actions = new Set(job.allowed_actions);
  const editable = actions.has("edit_storyboard");
  const canConfirm = actions.has("confirm_storyboard");
  const estimate = useEstimate(job.id, true);
  const confirm = useJobCommand(job.id);
  const regenerate = useJobCommand(job.id);
  const current = estimate.data ?? job.estimate;
  const totalDuration = job.scenes.reduce((sum, s) => sum + s.duration_s, 0);
  const lastRejection = job.status === "rejected" ? job.reviews[0] : undefined;

  return (
    <Row gutter={16}>
      <Col xs={24} xl={16}>
        <Flex justify="space-between" align="center" style={{ marginBottom: 12 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t("storyboard.title")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t("storyboard.summary", { count: job.scenes.length, seconds: totalDuration })}
          </Typography.Text>
        </Flex>
        {lastRejection && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            title={t("storyboard.rejected", { name: lastRejection.reviewer_name })}
            description={lastRejection.reason}
          />
        )}
        {!editable && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            title={t("storyboard.readOnly")}
          />
        )}
        <Space orientation="vertical" style={{ width: "100%" }} size={12}>
          {job.scenes.map((scene) => (
            <SceneEditorCard
              key={[
                scene.id,
                scene.narration,
                scene.visual_prompt,
                scene.shot_type,
                scene.camera_move,
                scene.duration_s,
                scene.screen_text,
                scene.needs_first_frame,
                scene.first_frame_asset_id,
              ].join("|")}
              job={job}
              scene={scene}
              editable={editable}
            />
          ))}
        </Space>
      </Col>
      <Col xs={24} xl={8}>
        <div style={{ position: "sticky", top: 16 }}>
          {estimate.isError && <ErrorAlert error={estimate.error} />}
          <CostEstimatePanel estimate={current} loading={estimate.isPending && !current} />
          <ErrorAlert error={confirm.error ?? regenerate.error} />
          <Flex gap={8} style={{ marginTop: 16 }} wrap>
            {canConfirm && (
              <Popconfirm
                title={t("storyboard.confirmTitle")}
                description={t("storyboard.confirmDescription", {
                  amount: current ? current.total_cny.toFixed(2) : "—",
                })}
                okText={t("common.confirm")}
                cancelText={t("common.cancel")}
                onConfirm={() => confirm.mutate({ type: "confirm_storyboard" })}
              >
                <Button type="primary" icon={<CheckOutlined />} loading={confirm.isPending}>
                  {t("storyboard.confirm")}
                </Button>
              </Popconfirm>
            )}
            {actions.has("regenerate_script") && (
              <Popconfirm
                title={t("storyboard.regenerateScriptConfirm")}
                okText={t("common.confirm")}
                cancelText={t("common.cancel")}
                onConfirm={() => regenerate.mutate({ type: "regenerate_script" })}
              >
                <Button icon={<ReloadOutlined />} loading={regenerate.isPending}>
                  {t("storyboard.regenerateScript")}
                </Button>
              </Popconfirm>
            )}
          </Flex>
          {confirm.error instanceof ApiError && confirm.error.status === 409 && (
            <Typography.Text type="danger" style={{ display: "block", marginTop: 8 }}>
              {t("storyboard.overBudgetHint")}
            </Typography.Text>
          )}
        </div>
      </Col>
    </Row>
  );
}
