import { Tabs, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { AuditTab } from "./AuditTab";
import { BudgetTab } from "./BudgetTab";
import { TemplatesTab } from "./TemplatesTab";
import { UsersTab } from "./UsersTab";

const TABS = ["templates", "users", "budget", "audit"] as const;

export function AdminPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const current = params.get("tab");
  const active = TABS.find((tab) => tab === current) ?? "templates";

  return (
    <>
      <Typography.Title level={3}>{t("admin.title")}</Typography.Title>
      <Tabs
        activeKey={active}
        onChange={(key) => setParams({ tab: key }, { replace: true })}
        destroyOnHidden
        items={[
          { key: "templates", label: t("admin.tabs.templates"), children: <TemplatesTab /> },
          { key: "users", label: t("admin.tabs.users"), children: <UsersTab /> },
          { key: "budget", label: t("admin.tabs.budget"), children: <BudgetTab /> },
          { key: "audit", label: t("admin.tabs.audit"), children: <AuditTab /> },
        ]}
      />
    </>
  );
}
