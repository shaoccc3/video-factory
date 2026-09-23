import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import {
  App as AntdApp,
  Button,
  Col,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Switch,
  Table,
  Tag,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCreateTemplate, useTemplates, useUpdateTemplate } from "../../api/hooks";
import {
  AUDIO_MODES,
  RATIOS,
  type Template,
  type TemplateCreate,
  VIDEO_TYPES,
} from "../../api/types";
import { ErrorAlert } from "../../components/ErrorResult";

const EMPTY: TemplateCreate = {
  key: "",
  name: "",
  description: "",
  video_type: "marketing",
  ratio: "9:16",
  resolution: "720p",
  min_duration_s: 15,
  max_duration_s: 30,
  min_shots: 3,
  max_shots: 6,
  audio_mode: "tts",
  subtitle_required: false,
  style_prefix: "",
  prompt_template: "",
  is_active: true,
};

function toCreate(tpl: Template): TemplateCreate {
  const { id: _id, version: _version, ...rest } = tpl;
  return rest;
}

function TemplateModal({
  editing,
  onClose,
}: {
  editing: Template | "new" | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<TemplateCreate>();
  const create = useCreateTemplate();
  const update = useUpdateTemplate();
  const isNew = editing === "new";

  const save = (values: TemplateCreate) => {
    const onSuccess = () => {
      void message.success(t("common.saved"));
      onClose();
    };
    if (editing === "new") create.mutate(values, { onSuccess });
    else if (editing) update.mutate({ id: editing.id, body: values }, { onSuccess });
  };

  return (
    <Modal
      open={editing !== null}
      title={isNew ? t("admin.templates.create") : t("admin.templates.edit")}
      width={800}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText={t("common.save")}
      cancelText={t("common.cancel")}
      confirmLoading={create.isPending || update.isPending}
      destroyOnHidden
    >
      <ErrorAlert error={create.error ?? update.error} />
      <Form<TemplateCreate>
        form={form}
        layout="vertical"
        initialValues={editing && editing !== "new" ? toCreate(editing) : EMPTY}
        onFinish={save}
      >
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="key" label={t("admin.templates.key")} rules={[{ required: true }]}>
              <Input disabled={!isNew} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="name" label={t("admin.templates.name")} rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item name="description" label={t("admin.templates.description")}>
              <Input.TextArea rows={2} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name="video_type"
              label={t("jobs.columns.type")}
              rules={[{ required: true }]}
            >
              <Select
                options={VIDEO_TYPES.map((v) => ({ value: v, label: t(`videoType.${v}`) }))}
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="ratio" label={t("wizard.fields.ratio")} rules={[{ required: true }]}>
              <Select options={RATIOS.map((r) => ({ value: r, label: r }))} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name="resolution"
              label={t("admin.templates.resolution")}
              rules={[{ required: true }]}
            >
              <Select options={["480p", "720p", "1080p"].map((r) => ({ value: r, label: r }))} />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="min_duration_s" label={t("admin.templates.minDuration")}>
              <InputNumber min={1} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="max_duration_s" label={t("admin.templates.maxDuration")}>
              <InputNumber min={1} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="min_shots" label={t("admin.templates.minShots")}>
              <InputNumber min={1} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="max_shots" label={t("admin.templates.maxShots")}>
              <InputNumber min={1} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="audio_mode" label={t("wizard.fields.audioMode")}>
              <Select
                options={AUDIO_MODES.map((m) => ({ value: m, label: t(`audioMode.${m}`) }))}
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name="subtitle_required"
              label={t("admin.templates.subtitleRequired")}
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="is_active" label={t("admin.templates.active")} valuePropName="checked">
              <Switch />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item name="style_prefix" label={t("admin.templates.stylePrefix")}>
              <Input.TextArea rows={2} />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item
              name="prompt_template"
              label={t("admin.templates.promptTemplate")}
              extra={t("admin.templates.promptHelp")}
            >
              <Input.TextArea rows={6} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}

export function TemplatesTab() {
  const { t } = useTranslation();
  const templates = useTemplates(true);
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  return (
    <>
      <Flex justify="flex-end" style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing("new")}>
          {t("admin.templates.create")}
        </Button>
      </Flex>
      <ErrorAlert error={templates.error} />
      <Table<Template>
        rowKey="id"
        loading={templates.isFetching}
        dataSource={templates.data ?? []}
        pagination={false}
        scroll={{ x: 900 }}
        columns={[
          { title: t("admin.templates.key"), dataIndex: "key" },
          { title: t("admin.templates.name"), dataIndex: "name" },
          {
            title: t("jobs.columns.type"),
            dataIndex: "video_type",
            render: (v: Template["video_type"]) => t(`videoType.${v}`),
          },
          { title: t("wizard.fields.ratio"), dataIndex: "ratio" },
          {
            title: t("admin.templates.durationRange"),
            key: "duration",
            render: (_, tpl) => `${tpl.min_duration_s}–${tpl.max_duration_s}s`,
          },
          {
            title: t("admin.templates.shotRange"),
            key: "shots",
            render: (_, tpl) => `${tpl.min_shots}–${tpl.max_shots}`,
          },
          {
            title: t("wizard.fields.audioMode"),
            dataIndex: "audio_mode",
            render: (v: Template["audio_mode"]) => t(`audioMode.${v}`),
          },
          { title: t("admin.templates.version"), dataIndex: "version", align: "right" },
          {
            title: t("admin.templates.active"),
            dataIndex: "is_active",
            render: (v: boolean) =>
              v ? <Tag color="success">{t("common.yes")}</Tag> : <Tag>{t("common.no")}</Tag>,
          },
          {
            key: "edit",
            render: (_, tpl) => (
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => setEditing(tpl)}
                aria-label={t("common.edit")}
              >
                {t("common.edit")}
              </Button>
            ),
          },
        ]}
      />
      <TemplateModal editing={editing} onClose={() => setEditing(null)} />
    </>
  );
}
