import { PlusOutlined } from "@ant-design/icons";
import { Button, Empty, Flex, Table, Typography } from "antd";
import { useTranslation } from "react-i18next";

interface JobRow {
  id: string;
  title: string;
  type: string;
  status: string;
  createdAt: string;
}

export function JobsPage() {
  const { t } = useTranslation();
  const jobs: JobRow[] = [];

  return (
    <>
      <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t("jobs.title")}
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} disabled>
          {t("jobs.new")}
        </Button>
      </Flex>
      <Table<JobRow>
        rowKey="id"
        dataSource={jobs}
        locale={{ emptyText: <Empty description={t("jobs.empty")} /> }}
        columns={[
          { title: t("jobs.columns.title"), dataIndex: "title" },
          { title: t("jobs.columns.type"), dataIndex: "type" },
          { title: t("jobs.columns.status"), dataIndex: "status" },
          { title: t("jobs.columns.createdAt"), dataIndex: "createdAt" },
        ]}
      />
    </>
  );
}
