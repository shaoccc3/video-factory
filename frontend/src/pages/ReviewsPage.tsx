import {
  App as AntdApp,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Result,
  Row,
  Spin,
  Table,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { useJob, useReviewQueue } from "../api/hooks";
import type { JobSummary } from "../api/types";
import { ErrorAlert, ErrorResult } from "../components/ErrorResult";
import { FinalPreview, ReviewHistory } from "../components/job/JobPanels";
import { ReviewForm } from "../components/ReviewForm";
import { JobStatusTag } from "../components/StatusTag";
import { formatCny, formatDateTime } from "../utils/format";

export function ReviewsPage() {
  const { t, i18n } = useTranslation();
  const queue = useReviewQueue();
  const navigate = useNavigate();
  return (
    <>
      <Typography.Title level={3}>{t("review.queueTitle")}</Typography.Title>
      <ErrorAlert error={queue.error} />
      <Table<JobSummary>
        rowKey="id"
        loading={queue.isFetching}
        dataSource={queue.data ?? []}
        locale={{ emptyText: <Empty description={t("review.queueEmpty")} /> }}
        columns={[
          {
            title: t("jobs.columns.title"),
            dataIndex: "title",
            render: (title: string, job) => <Link to={`/reviews/${job.id}`}>{title}</Link>,
          },
          { title: t("jobs.columns.template"), dataIndex: "template_name" },
          { title: t("jobs.columns.owner"), dataIndex: "owner_name" },
          {
            title: t("jobs.columns.cost"),
            dataIndex: "actual_cost_cny",
            align: "right",
            render: (v: number) => formatCny(v),
          },
          {
            title: t("review.submittedAt"),
            dataIndex: "updated_at",
            render: (v: string) => formatDateTime(v, i18n.language),
          },
          {
            key: "action",
            render: (_, job) => (
              <Button
                type="primary"
                size="small"
                onClick={() => void navigate(`/reviews/${job.id}`)}
              >
                {t("actions.review")}
              </Button>
            ),
          },
        ]}
      />
    </>
  );
}

export function ReviewDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const job = useJob(id);
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();

  if (job.isPending) return <Spin />;
  if (job.isError) return <ErrorResult error={job.error} onRetry={() => void job.refetch()} />;
  const data = job.data;
  const canReview = data.allowed_actions.includes("review");

  return (
    <>
      <Flex align="center" gap={8} style={{ marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t("review.title")}：{data.title}
        </Typography.Title>
        <JobStatusTag status={data.status} />
        <Link to={`/jobs/${data.id}`}>{t("review.openJob")}</Link>
      </Flex>
      <Row gutter={16}>
        <Col xs={24} lg={15}>
          <FinalPreview job={data} />
          <ReviewHistory reviews={data.reviews} />
        </Col>
        <Col xs={24} lg={9}>
          <Card>
            {canReview ? (
              <ReviewForm
                job={data}
                onDone={() => {
                  void message.success(t("review.done"));
                  void navigate(`/jobs/${data.id}`);
                }}
              />
            ) : (
              <Result status="info" title={t("review.notReviewable")} />
            )}
          </Card>
        </Col>
      </Row>
    </>
  );
}
