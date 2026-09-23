import { App as AntdApp, Button, Card, Descriptions, Form, InputNumber, Spin, Table } from "antd";
import { useTranslation } from "react-i18next";
import { useModelsConfig, useUpdateBudget } from "../../api/hooks";
import type { BudgetConfig, ModelConfig } from "../../api/types";
import { ErrorAlert, ErrorResult } from "../../components/ErrorResult";

type ModelRow = ModelConfig & { key: string };

export function BudgetTab() {
  const { t } = useTranslation();
  const { message } = AntdApp.useApp();
  const config = useModelsConfig();
  const update = useUpdateBudget();

  if (config.isPending) return <Spin />;
  if (config.isError)
    return <ErrorResult error={config.error} onRetry={() => void config.refetch()} />;
  const data = config.data;
  const rows: ModelRow[] = Object.entries(data.models).map(([key, m]) => ({ ...m, key }));
  const num = (v: number | undefined) => (v === undefined ? "—" : String(v));

  return (
    <>
      <Card title={t("admin.budget.budgetTitle")} style={{ marginBottom: 16 }}>
        <ErrorAlert error={update.error} />
        <Form<BudgetConfig>
          layout="inline"
          initialValues={data.budget}
          key={`${data.budget.per_job_cny}-${data.budget.per_user_daily_cny}`}
          onFinish={(values) =>
            update.mutate(values, { onSuccess: () => void message.success(t("common.saved")) })
          }
        >
          <Form.Item
            name="per_job_cny"
            label={t("admin.budget.perJob")}
            rules={[{ required: true }]}
          >
            <InputNumber min={0} prefix="¥" />
          </Form.Item>
          <Form.Item
            name="per_user_daily_cny"
            label={t("admin.budget.perUserDaily")}
            rules={[{ required: true }]}
          >
            <InputNumber min={0} prefix="¥" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={update.isPending}>
            {t("common.save")}
          </Button>
        </Form>
      </Card>
      <Card title={t("admin.budget.modelsTitle")}>
        <Descriptions
          size="small"
          style={{ marginBottom: 16 }}
          items={[
            { key: "region", label: t("admin.budget.region"), children: data.region },
            { key: "mode", label: t("admin.budget.providerMode"), children: data.provider_mode },
            { key: "currency", label: t("admin.budget.currency"), children: data.currency },
          ]}
        />
        <Table<ModelRow>
          size="small"
          rowKey="key"
          pagination={false}
          dataSource={rows}
          columns={[
            { title: t("admin.budget.modelKey"), dataIndex: "key" },
            { title: t("admin.budget.modelId"), dataIndex: "id" },
            {
              title: t("admin.budget.pricePerMtok"),
              dataIndex: "price_per_mtok",
              align: "right",
              render: num,
            },
            {
              title: t("admin.budget.pricePerImage"),
              dataIndex: "price_per_image",
              align: "right",
              render: num,
            },
            { title: "RPM", dataIndex: "rpm", align: "right", render: num },
            {
              title: t("admin.budget.concurrency"),
              dataIndex: "concurrency",
              align: "right",
              render: num,
            },
          ]}
        />
      </Card>
    </>
  );
}
