import { Layout, Menu, Select, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link, Outlet } from "react-router";
import { isLanguage, LANGUAGES } from "../i18n";

export function AppLayout() {
  const { t, i18n } = useTranslation();

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Layout.Header style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <Typography.Text strong style={{ color: "#fff", fontSize: 18 }}>
          {t("app.name")}
        </Typography.Text>
        <Menu
          theme="dark"
          mode="horizontal"
          selectable={false}
          style={{ flex: 1 }}
          items={[{ key: "jobs", label: <Link to="/jobs">{t("nav.jobs")}</Link> }]}
        />
        <Space>
          <Select
            aria-label={t("language.label")}
            value={i18n.language}
            style={{ width: 120 }}
            onChange={(value: string) => {
              if (isLanguage(value)) void i18n.changeLanguage(value);
            }}
            options={LANGUAGES.map((lng) => ({ value: lng, label: t(`language.${lng}`) }))}
          />
          <Link to="/login">{t("nav.logout")}</Link>
        </Space>
      </Layout.Header>
      <Layout.Content style={{ padding: 24 }}>
        <Outlet />
      </Layout.Content>
    </Layout>
  );
}
