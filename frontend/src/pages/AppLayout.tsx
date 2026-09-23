import { LogoutOutlined, UserOutlined } from "@ant-design/icons";
import { Button, Layout, Menu, Select, Space, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { useLogout } from "../api/hooks";
import type { Role } from "../api/types";
import { useCurrentUser } from "../auth/auth";
import { isLanguage, LANGUAGES } from "../i18n";

interface NavItem {
  key: string;
  path: string;
  role?: Role;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "jobs", path: "/jobs" },
  { key: "batches", path: "/batches" },
  { key: "library", path: "/library" },
  { key: "assets", path: "/assets" },
  { key: "reviews", path: "/reviews", role: "reviewer" },
  { key: "usage", path: "/usage" },
  { key: "admin", path: "/admin", role: "admin" },
];

export function AppLayout() {
  const { t, i18n } = useTranslation();
  const user = useCurrentUser();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();

  const items = NAV_ITEMS.filter((item) => !item.role || user.roles.includes(item.role));
  const selected = items.find((item) => location.pathname.startsWith(item.path))?.key;

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Layout.Header style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <Typography.Text strong style={{ color: "#fff", fontSize: 18, whiteSpace: "nowrap" }}>
          {t("app.name")}
        </Typography.Text>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={selected ? [selected] : []}
          style={{ flex: 1, minWidth: 0 }}
          items={items.map((item) => ({
            key: item.key,
            label: <Link to={item.path}>{t(`nav.${item.key}`)}</Link>,
          }))}
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
          <Space size={4} data-testid="current-user">
            <UserOutlined style={{ color: "#fff" }} />
            <Typography.Text style={{ color: "#fff" }}>{user.display_name}</Typography.Text>
            {user.roles.map((role) => (
              <Tag key={role} color="blue">
                {t(`role.${role}`)}
              </Tag>
            ))}
          </Space>
          <Button
            type="text"
            icon={<LogoutOutlined />}
            style={{ color: "#fff" }}
            loading={logout.isPending}
            onClick={() =>
              logout.mutate(undefined, {
                onSettled: () => void navigate("/login", { replace: true }),
              })
            }
          >
            {t("nav.logout")}
          </Button>
        </Space>
      </Layout.Header>
      <Layout.Content style={{ padding: 24 }}>
        <Outlet />
      </Layout.Content>
    </Layout>
  );
}
