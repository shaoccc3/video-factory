import { PlusOutlined } from "@ant-design/icons";
import { Button, Empty, Flex, Input, Progress, Select, Switch, Table, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useJobs } from "../api/hooks";
import {
  JOB_STATUSES,
  type JobStatus,
  type JobSummary,
  VIDEO_TYPES,
  type VideoType,
} from "../api/types";
import { ErrorAlert } from "../components/ErrorResult";
import { JobStatusTag } from "../components/StatusTag";
import { formatCny, formatDateTime, percent } from "../utils/format";

function pick<T extends string>(values: readonly T[], value: string | null): T | undefined {
  return (values as readonly string[]).includes(value ?? "") ? (value as T) : undefined;
}

export function JobProgressBar({ job }: { job: JobSummary }) {
  if (job.progress.total === 0) return <Typography.Text type="secondary">—</Typography.Text>;
  return (
    <Progress
      size="small"
      style={{ minWidth: 100, margin: 0 }}
      percent={percent(job.progress.succeeded + job.progress.failed, job.progress.total)}
      success={{ percent: percent(job.progress.succeeded, job.progress.total) }}
      status={job.progress.failed > 0 ? "exception" : "normal"}
      format={() => `${job.progress.succeeded}/${job.progress.total}`}
    />
  );
}

export function JobsPage() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const status = pick<JobStatus>(JOB_STATUSES, params.get("status"));
  const videoType = pick<VideoType>(VIDEO_TYPES, params.get("video_type"));
  const mine = params.get("mine") === "1";
  const q = params.get("q") ?? "";
  const page = Number(params.get("page") ?? "1") || 1;
  const pageSize = Number(params.get("page_size") ?? "20") || 20;

  const jobs = useJobs({
    status,
    video_type: videoType,
    mine: mine || undefined,
    q: q || undefined,
    page,
    page_size: pageSize,
  });

  const update = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in changes)) next.delete("page");
    setParams(next, { replace: true });
  };

  return (
    <>
      <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t("jobs.title")}
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => void navigate("/jobs/new")}>
          {t("jobs.new")}
        </Button>
      </Flex>
      <Flex gap={12} wrap style={{ marginBottom: 16 }} align="center">
        <Select
          aria-label={t("jobs.columns.status")}
          allowClear
          placeholder={t("jobs.filterStatus")}
          style={{ width: 160 }}
          value={status}
          onChange={(v?: JobStatus) => update({ status: v })}
          options={JOB_STATUSES.map((s) => ({ value: s, label: t(`jobStatus.${s}`) }))}
        />
        <Select
          aria-label={t("jobs.columns.type")}
          allowClear
          placeholder={t("jobs.filterType")}
          style={{ width: 160 }}
          value={videoType}
          onChange={(v?: VideoType) => update({ video_type: v })}
          options={VIDEO_TYPES.map((v) => ({ value: v, label: t(`videoType.${v}`) }))}
        />
        <Input.Search
          allowClear
          style={{ width: 240 }}
          placeholder={t("jobs.search")}
          defaultValue={q}
          onSearch={(text) => update({ q: text })}
        />
        <Flex gap={6} align="center">
          <Switch
            checked={mine}
            onChange={(checked) => update({ mine: checked ? "1" : undefined })}
            aria-label={t("jobs.mine")}
          />
          <Typography.Text>{t("jobs.mine")}</Typography.Text>
        </Flex>
      </Flex>
      <ErrorAlert error={jobs.error} />
      <Table<JobSummary>
        rowKey="id"
        loading={jobs.isFetching}
        dataSource={jobs.data?.items ?? []}
        locale={{ emptyText: <Empty description={t("jobs.empty")} /> }}
        pagination={{
          current: page,
          pageSize,
          total: jobs.data?.total ?? 0,
          showSizeChanger: true,
          onChange: (p, size) => update({ page: String(p), page_size: String(size) }),
        }}
        scroll={{ x: 960 }}
        columns={[
          {
            title: t("jobs.columns.title"),
            dataIndex: "title",
            render: (title: string, job) => <Link to={`/jobs/${job.id}`}>{title}</Link>,
          },
          {
            title: t("jobs.columns.type"),
            dataIndex: "video_type",
            render: (v: VideoType) => t(`videoType.${v}`),
          },
          { title: t("jobs.columns.template"), dataIndex: "template_name" },
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
          { title: t("jobs.columns.owner"), dataIndex: "owner_name" },
          {
            title: t("jobs.columns.cost"),
            key: "cost",
            align: "right",
            render: (_, job) =>
              `${formatCny(job.actual_cost_cny)} / ${formatCny(job.estimated_cost_cny)}`,
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
