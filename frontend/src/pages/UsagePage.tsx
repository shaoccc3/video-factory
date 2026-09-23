import {
  Card,
  Col,
  Empty,
  Flex,
  Progress,
  Row,
  Segmented,
  Spin,
  Statistic,
  Table,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useUsage } from "../api/hooks";
import type { UsageSummary } from "../api/types";
import { ErrorResult } from "../components/ErrorResult";
import { formatCny, percent } from "../utils/format";

type Day = UsageSummary["by_day"][number];

/** 簡單的 SVG 柱狀圖（每日花費），不引入圖表庫 */
export function DailyBarChart({ data }: { data: Day[] }) {
  const { t } = useTranslation();
  if (data.length === 0) return <Empty description={t("usage.noData")} />;
  const width = 720;
  const height = 220;
  const padBottom = 28;
  const padTop = 16;
  const max = Math.max(...data.map((d) => d.amount_cny), 0.01);
  const slot = width / data.length;
  const bar = Math.max(2, slot * 0.7);
  const labelEvery = Math.ceil(data.length / 10);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label={t("usage.byDay")}
      style={{ maxHeight: 260 }}
    >
      <line x1={0} x2={width} y1={height - padBottom} y2={height - padBottom} stroke="#d9d9d9" />
      {data.map((d, i) => {
        const h = ((height - padBottom - padTop) * d.amount_cny) / max;
        const x = i * slot + (slot - bar) / 2;
        const y = height - padBottom - h;
        return (
          <g key={d.date}>
            <rect x={x} y={y} width={bar} height={h} fill="#1677ff" rx={2}>
              <title>{`${d.date}: ${formatCny(d.amount_cny)}`}</title>
            </rect>
            {i % labelEvery === 0 && (
              <text x={x + bar / 2} y={height - 8} fontSize={11} textAnchor="middle" fill="#8c8c8c">
                {d.date.slice(5)}
              </text>
            )}
          </g>
        );
      })}
      <text x={4} y={12} fontSize={11} fill="#8c8c8c">
        {formatCny(max)}
      </text>
    </svg>
  );
}

export function UsagePage() {
  const { t } = useTranslation();
  const [days, setDays] = useState(30);
  const usage = useUsage(days);

  if (usage.isError)
    return <ErrorResult error={usage.error} onRetry={() => void usage.refetch()} />;
  const data = usage.data;
  const todayPct = data ? percent(data.today_user_cny, data.daily_budget_cny) : 0;

  return (
    <>
      <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t("usage.title")}
        </Typography.Title>
        <Segmented<number>
          value={days}
          onChange={setDays}
          options={[7, 30, 90].map((d) => ({ value: d, label: t("usage.days", { count: d }) }))}
        />
      </Flex>
      <Spin spinning={usage.isFetching}>
        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <Card>
              <Statistic
                title={t("usage.total", { count: days })}
                value={data?.total_cny ?? 0}
                precision={2}
                prefix="¥"
              />
            </Card>
          </Col>
          <Col xs={24} md={16}>
            <Card>
              <Typography.Text type="secondary">{t("usage.today")}</Typography.Text>
              <Flex align="baseline" gap={8}>
                <Typography.Title level={3} style={{ margin: 0 }}>
                  {formatCny(data?.today_user_cny)}
                </Typography.Title>
                <Typography.Text type="secondary">
                  / {formatCny(data?.daily_budget_cny)}
                </Typography.Text>
              </Flex>
              <Progress
                percent={todayPct}
                status={todayPct >= 100 ? "exception" : "normal"}
                {...(todayPct >= 80 && todayPct < 100 ? { strokeColor: "#faad14" } : {})}
                aria-label={t("usage.today")}
              />
              {todayPct >= 80 && (
                <Typography.Text type="warning">{t("usage.nearLimit")}</Typography.Text>
              )}
            </Card>
          </Col>
          <Col span={24}>
            <Card title={t("usage.byDay")}>
              <DailyBarChart data={data?.by_day ?? []} />
            </Card>
          </Col>
          {data && data.by_user.length > 0 && (
            <Col xs={24} lg={12}>
              <Card title={t("usage.byUser")}>
                <Table
                  size="small"
                  rowKey="user_id"
                  pagination={false}
                  dataSource={data.by_user}
                  columns={[
                    { title: t("usage.user"), dataIndex: "display_name" },
                    {
                      title: t("usage.amount"),
                      dataIndex: "amount_cny",
                      align: "right",
                      render: (v: number) => formatCny(v),
                    },
                  ]}
                />
              </Card>
            </Col>
          )}
          <Col xs={24} lg={12}>
            <Card title={t("usage.byModel")}>
              <Table
                size="small"
                rowKey="model_id"
                pagination={false}
                dataSource={data?.by_model ?? []}
                columns={[
                  { title: t("usage.model"), dataIndex: "model_id" },
                  { title: t("usage.calls"), dataIndex: "calls", align: "right" },
                  {
                    title: t("usage.amount"),
                    dataIndex: "amount_cny",
                    align: "right",
                    render: (v: number) => formatCny(v),
                  },
                ]}
              />
            </Card>
          </Col>
        </Row>
      </Spin>
    </>
  );
}
