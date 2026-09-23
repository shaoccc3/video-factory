import { Tabs } from "antd";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { AuditTab } from "./AuditTab";
import { BudgetTab } from "./BudgetTab";
import { TemplatesTab } from "./TemplatesTab";
import { UsersTab } from "./UsersTab";
import "./admin.css";

const TABS = ["templates", "users", "budget", "audit"] as const;

export function AdminPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const current = params.get("tab");
  const active = TABS.find((tab) => tab === current) ?? "templates";

  return (
    <div className="vf-admin">
      <header className="vf-admin-head vf-rise">
        <span className="vf-label">CONTROL ROOM</span>
        <h1 className="vf-serif">{t("admin.title")}</h1>
      </header>
      <Tabs
        className="vf-admin-tabs vf-rise-2"
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
    </div>
  );
}
