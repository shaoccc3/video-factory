import { Flex, Input, Table, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuditLogs } from "../../api/hooks";
import type { AuditLog } from "../../api/types";
import { ErrorAlert } from "../../components/ErrorResult";
import { formatDateTime } from "../../utils/format";

export function formatDetail(detail: unknown): string {
  if (detail === null || detail === undefined || detail === "") return "—";
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

export function AuditTab() {
  const { t, i18n } = useTranslation();
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const logs = useAuditLogs({ action: action || undefined, page, page_size: pageSize });

  return (
    <>
      <Flex style={{ marginBottom: 12 }}>
        <Input.Search
          allowClear
          style={{ width: 260 }}
          placeholder={t("admin.audit.filterAction")}
          onSearch={(text) => {
            setAction(text.trim());
            setPage(1);
          }}
        />
      </Flex>
      <ErrorAlert error={logs.error} />
      <Table<AuditLog>
        size="small"
        rowKey="id"
        loading={logs.isFetching}
        dataSource={logs.data?.items ?? []}
        scroll={{ x: 900 }}
        pagination={{
          current: page,
          pageSize,
          total: logs.data?.total ?? 0,
          showSizeChanger: true,
          onChange: (p, size) => {
            setPage(p);
            setPageSize(size);
          },
        }}
        columns={[
          {
            title: t("admin.audit.time"),
            dataIndex: "created_at",
            render: (v: string) => formatDateTime(v, i18n.language),
          },
          {
            title: t("admin.audit.actor"),
            dataIndex: "actor_name",
            render: (v: string | null) => v ?? "—",
          },
          { title: t("admin.audit.action"), dataIndex: "action" },
          {
            title: t("admin.audit.target"),
            key: "target",
            render: (_, log) =>
              log.target_type
                ? `${log.target_type}${log.target_id ? `:${log.target_id}` : ""}`
                : "—",
          },
          {
            title: t("admin.audit.detail"),
            dataIndex: "detail",
            render: (v: unknown) => (
              <Typography.Text code ellipsis style={{ maxWidth: 360 }}>
                {formatDetail(v)}
              </Typography.Text>
            ),
          },
          { title: "IP", dataIndex: "ip", render: (v: string | null) => v ?? "—" },
        ]}
      />
    </>
  );
}
