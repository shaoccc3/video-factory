import { InboxOutlined, PlusOutlined } from "@ant-design/icons";
import {
  App as AntdApp,
  Button,
  Card,
  Descriptions,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import {
  useBatch,
  useBatches,
  useCreateBatchCsv,
  useCreateBatchImages,
  useTemplates,
} from "../api/hooks";
import type { Batch, JobStatus, JobSummary, Template } from "../api/types";
import { ErrorAlert, ErrorResult } from "../components/ErrorResult";
import { JobStatusTag, StatusSlate } from "../components/StatusTag";
import { formatCny, formatDateTime } from "../utils/format";
import { JobProgressBar } from "./JobsPage";

function BatchCounts({ counts }: { counts: Batch["counts"] }) {
  const { t } = useTranslation();
  const entries = Object.entries(counts) as [JobStatus, number][];
  if (entries.length === 0) return <>—</>;
  return (
    <Flex gap={4} wrap>
      {entries.map(([status, n]) => (
        <StatusSlate key={status} tone="muted" label={`${t(`jobStatus.${status}`)} ${n}`} />
      ))}
    </Flex>
  );
}

interface CsvValues {
  template_id: string;
  max_parallel: number;
  draft_mode: boolean;
}

interface ImagesValues extends CsvValues {
  topic: string;
}

function templateOptions(templates: Template[] | undefined, quickOnly: boolean) {
  return (templates ?? [])
    .filter((tpl) => !quickOnly || tpl.video_type === "quick")
    .map((tpl) => ({ value: tpl.id, label: tpl.name }));
}

function CreateBatchModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const templates = useTemplates();
  const csv = useCreateBatchCsv();
  const images = useCreateBatchImages();
  const [tab, setTab] = useState("csv");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [csvForm] = Form.useForm<CsvValues>();
  const [imagesForm] = Form.useForm<ImagesValues>();

  const done = (batch: Batch) => {
    onCreated();
    void navigate(`/batches/${batch.id}`);
  };

  const submitCsv = (values: CsvValues) => {
    if (!csvFile) return;
    csv.mutate({ ...values, file: csvFile }, { onSuccess: done });
  };
  const submitImages = (values: ImagesValues) => {
    if (imageFiles.length === 0) return;
    images.mutate({ ...values, files: imageFiles }, { onSuccess: done });
  };

  const defaults = { max_parallel: 2, draft_mode: false };

  return (
    <Modal
      open={open}
      title={t("batches.create")}
      onCancel={onClose}
      footer={null}
      width={640}
      destroyOnHidden
    >
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "csv",
            label: t("batches.fromCsv"),
            children: (
              <Form<CsvValues>
                form={csvForm}
                layout="vertical"
                initialValues={defaults}
                onFinish={submitCsv}
              >
                <ErrorAlert error={csv.error} />
                <Form.Item
                  name="template_id"
                  label={t("batches.template")}
                  rules={[{ required: true, message: t("batches.templateRequired") }]}
                >
                  <Select
                    loading={templates.isPending}
                    options={templateOptions(templates.data, false)}
                  />
                </Form.Item>
                <Form.Item label={t("batches.csvFile")} required extra={t("batches.csvHelp")}>
                  <Upload.Dragger
                    accept=".csv,text/csv"
                    maxCount={1}
                    beforeUpload={(file) => {
                      setCsvFile(file);
                      return false;
                    }}
                    onRemove={() => setCsvFile(null)}
                    fileList={csvFile ? [{ uid: "csv", name: csvFile.name, status: "done" }] : []}
                  >
                    <p className="ant-upload-drag-icon">
                      <InboxOutlined />
                    </p>
                    <p>{t("batches.dropCsv")}</p>
                  </Upload.Dragger>
                </Form.Item>
                <Flex gap={24}>
                  <Form.Item name="max_parallel" label={t("batches.maxParallel")}>
                    <InputNumber min={1} max={10} />
                  </Form.Item>
                  <Form.Item
                    name="draft_mode"
                    label={t("wizard.fields.draftMode")}
                    valuePropName="checked"
                  >
                    <Switch />
                  </Form.Item>
                </Flex>
                <Button
                  type="primary"
                  htmlType="submit"
                  disabled={!csvFile}
                  loading={csv.isPending}
                >
                  {t("batches.submit")}
                </Button>
              </Form>
            ),
          },
          {
            key: "images",
            label: t("batches.fromImages"),
            children: (
              <Form<ImagesValues>
                form={imagesForm}
                layout="vertical"
                initialValues={defaults}
                onFinish={submitImages}
              >
                <ErrorAlert error={images.error} />
                <Form.Item
                  name="template_id"
                  label={t("batches.template")}
                  rules={[{ required: true, message: t("batches.templateRequired") }]}
                  extra={t("batches.quickOnly")}
                >
                  <Select
                    loading={templates.isPending}
                    options={templateOptions(templates.data, true)}
                  />
                </Form.Item>
                <Form.Item
                  name="topic"
                  label={t("batches.topic")}
                  rules={[
                    { required: true, whitespace: true, message: t("batches.topicRequired") },
                  ]}
                >
                  <Input.TextArea rows={2} />
                </Form.Item>
                <Form.Item label={t("batches.images")} required>
                  <Upload.Dragger
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    beforeUpload={(file) => {
                      setImageFiles((cur) => [...cur, file]);
                      return false;
                    }}
                    onRemove={(file) =>
                      setImageFiles((cur) => cur.filter((f, i) => `${i}-${f.name}` !== file.uid))
                    }
                    fileList={imageFiles.map((f, i) => ({
                      uid: `${i}-${f.name}`,
                      name: f.name,
                      status: "done" as const,
                    }))}
                  >
                    <p className="ant-upload-drag-icon">
                      <InboxOutlined />
                    </p>
                    <p>{t("batches.dropImages")}</p>
                  </Upload.Dragger>
                </Form.Item>
                <Flex gap={24}>
                  <Form.Item name="max_parallel" label={t("batches.maxParallel")}>
                    <InputNumber min={1} max={10} />
                  </Form.Item>
                  <Form.Item
                    name="draft_mode"
                    label={t("wizard.fields.draftMode")}
                    valuePropName="checked"
                  >
                    <Switch />
                  </Form.Item>
                </Flex>
                <Button
                  type="primary"
                  htmlType="submit"
                  disabled={imageFiles.length === 0}
                  loading={images.isPending}
                >
                  {t("batches.submitImages", { count: imageFiles.length })}
                </Button>
              </Form>
            ),
          },
        ]}
      />
    </Modal>
  );
}

export function BatchesPage() {
  const { t, i18n } = useTranslation();
  const batches = useBatches();
  const [open, setOpen] = useState(false);
  const { message } = AntdApp.useApp();
  return (
    <>
      <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t("batches.title")}
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          {t("batches.create")}
        </Button>
      </Flex>
      <ErrorAlert error={batches.error} />
      <Table<Batch>
        rowKey="id"
        loading={batches.isFetching}
        dataSource={batches.data ?? []}
        locale={{ emptyText: <Empty description={t("batches.empty")} /> }}
        columns={[
          {
            title: t("batches.createdAt"),
            dataIndex: "created_at",
            render: (v: string, batch) => (
              <Link to={`/batches/${batch.id}`}>{formatDateTime(v, i18n.language)}</Link>
            ),
          },
          { title: t("batches.template"), dataIndex: "template_name" },
          { title: t("batches.total"), dataIndex: "total", align: "right" },
          { title: t("batches.maxParallel"), dataIndex: "max_parallel", align: "right" },
          {
            title: t("batches.status"),
            dataIndex: "status",
            render: (s: Batch["status"]) => (
              <Tag color={s === "running" ? "processing" : "success"}>{t(`batches.${s}`)}</Tag>
            ),
          },
          {
            title: t("batches.counts"),
            dataIndex: "counts",
            render: (counts: Batch["counts"]) => <BatchCounts counts={counts} />,
          },
        ]}
      />
      <CreateBatchModal
        open={open}
        onClose={() => setOpen(false)}
        onCreated={() => {
          setOpen(false);
          void message.success(t("batches.created"));
        }}
      />
    </>
  );
}

export function BatchDetailPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const batch = useBatch(id);
  if (batch.isPending) return <Spin />;
  if (batch.isError)
    return <ErrorResult error={batch.error} onRetry={() => void batch.refetch()} />;
  const data = batch.data;
  return (
    <>
      <Typography.Text type="secondary">
        <Link to="/batches">{t("batches.title")}</Link> /
      </Typography.Text>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        {t("batches.detailTitle", { name: data.template_name })}
      </Typography.Title>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Descriptions
          size="small"
          column={{ xs: 1, sm: 2, lg: 4 }}
          items={[
            {
              key: "created",
              label: t("batches.createdAt"),
              children: formatDateTime(data.created_at, i18n.language),
            },
            { key: "total", label: t("batches.total"), children: data.total },
            { key: "parallel", label: t("batches.maxParallel"), children: data.max_parallel },
            {
              key: "status",
              label: t("batches.status"),
              children: t(`batches.${data.status}`),
            },
            {
              key: "counts",
              label: t("batches.counts"),
              span: "filled",
              children: <BatchCounts counts={data.counts} />,
            },
          ]}
        />
      </Card>
      <Table<JobSummary>
        rowKey="id"
        dataSource={data.jobs}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        columns={[
          {
            title: t("jobs.columns.title"),
            dataIndex: "title",
            render: (title: string, job) => <Link to={`/jobs/${job.id}`}>{title}</Link>,
          },
          {
            title: t("jobs.columns.status"),
            dataIndex: "status",
            render: (s: JobStatus) => <JobStatusTag status={s} />,
          },
          {
            title: t("jobs.columns.progress"),
            key: "progress",
            render: (_, job) => <JobProgressBar job={job} />,
          },
          {
            title: t("jobs.columns.cost"),
            dataIndex: "actual_cost_cny",
            align: "right",
            render: (v: number) => formatCny(v),
          },
          {
            title: t("jobs.columns.createdAt"),
            dataIndex: "created_at",
            render: (v: string) => formatDateTime(v, i18n.language),
          },
        ]}
      />
    </>
  );
}
