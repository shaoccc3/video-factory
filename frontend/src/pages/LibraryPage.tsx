import { DownloadOutlined, PlayCircleOutlined, VideoCameraOutlined } from "@ant-design/icons";
import {
  Card,
  Col,
  Empty,
  Flex,
  Input,
  Modal,
  Pagination,
  Row,
  Segmented,
  Select,
  Spin,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { assetContentUrl, assetDownloadUrl, assetThumbnailUrl } from "../api/client";
import { useJobs } from "../api/hooks";
import { type JobSummary, VIDEO_TYPES, type VideoType } from "../api/types";
import { ErrorAlert } from "../components/ErrorResult";
import { JobStatusTag } from "../components/StatusTag";
import { formatDateTime } from "../utils/format";

type LibraryStatus = "approved" | "in_review";
const PAGE_SIZE = 24;

function Cover({ job }: { job: JobSummary }) {
  const style = {
    width: "100%",
    aspectRatio: "16 / 9",
    objectFit: "cover" as const,
    background: "#000",
    display: "block",
  };
  if (job.cover_asset_id) {
    return <img src={assetThumbnailUrl(job.cover_asset_id)} alt={job.title} style={style} />;
  }
  return (
    <Flex justify="center" align="center" style={{ ...style, color: "#888", fontSize: 32 }}>
      <VideoCameraOutlined />
    </Flex>
  );
}

export function LibraryPage() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<LibraryStatus>("approved");
  const [videoType, setVideoType] = useState<VideoType | undefined>();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<JobSummary | null>(null);
  const jobs = useJobs({
    status,
    video_type: videoType,
    q: q || undefined,
    page,
    page_size: PAGE_SIZE,
  });
  const items = (jobs.data?.items ?? []).filter((job) => job.final_asset_id !== null);

  return (
    <>
      <Typography.Title level={3}>{t("library.title")}</Typography.Title>
      <Flex gap={12} wrap style={{ marginBottom: 16 }}>
        <Segmented<LibraryStatus>
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: "approved", label: t("jobStatus.approved") },
            { value: "in_review", label: t("jobStatus.in_review") },
          ]}
        />
        <Select
          aria-label={t("jobs.columns.type")}
          allowClear
          placeholder={t("jobs.filterType")}
          style={{ width: 160 }}
          value={videoType}
          onChange={(v?: VideoType) => {
            setVideoType(v);
            setPage(1);
          }}
          options={VIDEO_TYPES.map((v) => ({ value: v, label: t(`videoType.${v}`) }))}
        />
        <Input.Search
          allowClear
          style={{ width: 260 }}
          placeholder={t("jobs.search")}
          onSearch={(text) => {
            setQ(text);
            setPage(1);
          }}
        />
      </Flex>
      <ErrorAlert error={jobs.error} />
      <Spin spinning={jobs.isFetching}>
        {items.length === 0 ? (
          <Empty description={t("library.empty")} />
        ) : (
          <Row gutter={[16, 16]}>
            {items.map((job) => (
              <Col key={job.id} xs={24} sm={12} md={8} xl={6}>
                <Card
                  cover={
                    <button
                      type="button"
                      onClick={() => setPreview(job)}
                      aria-label={t("library.preview")}
                      style={{ padding: 0, border: 0, cursor: "pointer", position: "relative" }}
                    >
                      <Cover job={job} />
                      <PlayCircleOutlined
                        style={{
                          position: "absolute",
                          inset: 0,
                          margin: "auto",
                          width: 48,
                          height: 48,
                          fontSize: 48,
                          color: "rgba(255,255,255,.85)",
                        }}
                      />
                    </button>
                  }
                  actions={[
                    <Link key="detail" to={`/jobs/${job.id}`}>
                      {t("library.detail")}
                    </Link>,
                    job.status === "approved" && job.final_asset_id ? (
                      <a key="download" href={assetDownloadUrl(job.final_asset_id)}>
                        <DownloadOutlined /> {t("final.download")}
                      </a>
                    ) : (
                      <Typography.Text key="locked" type="secondary">
                        {t("final.downloadLocked")}
                      </Typography.Text>
                    ),
                  ]}
                >
                  <Card.Meta
                    title={job.title}
                    description={
                      <Flex vertical gap={4}>
                        <Flex gap={4} wrap>
                          <JobStatusTag status={job.status} />
                          <Typography.Text type="secondary">
                            {t(`videoType.${job.video_type}`)} · {job.ratio}
                          </Typography.Text>
                        </Flex>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {job.owner_name} · {formatDateTime(job.updated_at, i18n.language)}
                        </Typography.Text>
                      </Flex>
                    }
                  />
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Spin>
      <Pagination
        style={{ marginTop: 16, textAlign: "right" }}
        current={page}
        pageSize={PAGE_SIZE}
        total={jobs.data?.total ?? 0}
        onChange={setPage}
        showSizeChanger={false}
        hideOnSinglePage
      />
      <Modal
        open={preview !== null}
        title={preview?.title}
        footer={null}
        onCancel={() => setPreview(null)}
        width={720}
        destroyOnHidden
      >
        {preview?.final_asset_id && (
          // biome-ignore lint/a11y/useMediaCaption: 成片字幕已燒錄進畫面
          <video
            src={assetContentUrl(preview.final_asset_id)}
            controls
            autoPlay
            style={{ width: "100%", maxHeight: "70vh", background: "#000" }}
          />
        )}
      </Modal>
    </>
  );
}
