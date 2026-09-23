import { Alert, Card, Descriptions, Progress, Table } from "antd";
import { useTranslation } from "react-i18next";
import type { CostEstimate, CostItem } from "../api/types";
import { formatCny, percent } from "../utils/format";

export function CostEstimatePanel({
  estimate,
  loading = false,
}: {
  estimate: CostEstimate | null | undefined;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  if (!estimate) {
    return <Card title={t("estimate.title")} loading={loading} size="small" />;
  }
  const afterToday = estimate.spent_today_cny + estimate.total_cny;
  return (
    <Card title={t("estimate.title")} size="small" loading={loading}>
      {!estimate.within_budget ? (
        <Alert
          type="error"
          showIcon
          title={t("estimate.overBudget")}
          style={{ marginBottom: 12 }}
          data-testid="budget-alert"
        />
      ) : estimate.near_limit ? (
        <Alert
          type="warning"
          showIcon
          title={t("estimate.nearLimit")}
          style={{ marginBottom: 12 }}
          data-testid="budget-alert"
        />
      ) : null}
      <Descriptions
        size="small"
        column={1}
        items={[
          { key: "total", label: t("estimate.total"), children: formatCny(estimate.total_cny) },
          {
            key: "perJob",
            label: t("estimate.perJobBudget"),
            children: formatCny(estimate.budget_per_job_cny),
          },
          {
            key: "today",
            label: t("estimate.todaySpent"),
            children: `${formatCny(estimate.spent_today_cny)} / ${formatCny(estimate.daily_budget_cny)}`,
          },
        ]}
      />
      <Progress
        percent={percent(afterToday, estimate.daily_budget_cny)}
        success={{ percent: percent(estimate.spent_today_cny, estimate.daily_budget_cny) }}
        status={!estimate.within_budget ? "exception" : "normal"}
        aria-label={t("estimate.dailyProgress")}
      />
      <Table<CostItem>
        size="small"
        rowKey={(item) => `${item.label}-${item.model_key}`}
        pagination={false}
        dataSource={estimate.items}
        columns={[
          { title: t("estimate.item"), dataIndex: "label" },
          { title: t("estimate.model"), dataIndex: "model_key" },
          {
            title: t("estimate.quantity"),
            render: (_, item) => `${item.quantity} ${item.unit}`,
          },
          {
            title: t("estimate.amount"),
            dataIndex: "amount_cny",
            align: "right",
            render: (v: number) => formatCny(v),
          },
        ]}
      />
    </Card>
  );
}
