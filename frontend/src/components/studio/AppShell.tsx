import { Dropdown, type MenuProps } from "antd";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useLogout, useReviewQueue } from "../../api/hooks";
import type { Role } from "../../api/types";
import { canCreate, hasRole, useCurrentUser } from "../../auth/auth";
import { formatTimecode, useNow } from "../../hooks/motion";
import { isLanguage, LANGUAGES } from "../../i18n";
import { Grain } from "./Grain";
import "./shell.css";

interface NavItem {
  key: string;
  path: string;
  role?: Role;
  /** 這些路徑也算在這一項底下 */
  also?: string[];
}

export const NAV_ITEMS: NavItem[] = [
  { key: "studio", path: "/", also: ["/jobs"] },
  { key: "library", path: "/library" },
  { key: "assets", path: "/assets" },
  { key: "batches", path: "/batches" },
  { key: "reviews", path: "/reviews", role: "reviewer" },
];

function isActive(item: NavItem, pathname: string): boolean {
  if (pathname === "/jobs/new") return false;
  if (item.path === "/")
    return pathname === "/" || (item.also ?? []).some((p) => pathname.startsWith(p));
  return pathname.startsWith(item.path);
}

function Timecode() {
  const { t } = useTranslation();
  const now = useNow();
  return (
    <span className="vf-shell-tc vf-mono" role="timer" aria-label={t("shell.timecode")}>
      {t("mono.tc", { time: formatTimecode(now) })}
    </span>
  );
}

/** 全站外殼：頂部導航、時間碼、帳號選單、開新片（規格 14 第 3 節） */
export function AppShell() {
  const { t, i18n } = useTranslation();
  const user = useCurrentUser();
  const logout = useLogout();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const reviewer = hasRole(user, "reviewer");
  const queue = useReviewQueue(reviewer);
  const waiting = queue.data?.length ?? 0;
  const items = NAV_ITEMS.filter((item) => !item.role || hasRole(user, item.role));

  const menu: MenuProps["items"] = [
    { key: "usage", label: <Link to="/usage">{t("nav.usage")}</Link> },
    ...(hasRole(user, "admin")
      ? [{ key: "admin", label: <Link to="/admin">{t("nav.admin")}</Link> }]
      : []),
    { type: "divider" as const },
    {
      key: "language",
      label: t("language.label"),
      children: LANGUAGES.map((lng) => ({
        key: `lang-${lng}`,
        label: t(`language.${lng}`),
        onClick: () => {
          if (isLanguage(lng)) void i18n.changeLanguage(lng);
        },
      })),
    },
    { type: "divider" as const },
    {
      key: "logout",
      label: t("nav.logout"),
      onClick: () =>
        logout.mutate(undefined, { onSettled: () => void navigate("/login", { replace: true }) }),
    },
  ];

  return (
    <div className="vf-shell">
      <header className="vf-shell-header">
        <Link to="/" className="vf-shell-brand">
          <span className="vf-serif">{t("app.name")}</span>
          <span className="vf-label">{t("shell.studio")}</span>
        </Link>
        <nav aria-label={t("shell.mainNav")} className="vf-shell-nav">
          {items.map((item) => (
            <NavLink
              key={item.key}
              to={item.path}
              className={isActive(item, pathname) ? "vf-shell-link is-active" : "vf-shell-link"}
              aria-current={isActive(item, pathname) ? "page" : undefined}
            >
              {t(`nav.${item.key}`)}
              {item.key === "reviews" && waiting > 0 && (
                <>
                  <span className="vf-shell-count vf-mono" aria-hidden="true">
                    {waiting}
                  </span>
                  <span className="vf-sr-only">{t("shell.waiting", { count: waiting })}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="vf-shell-spacer" />
        <Timecode />
        <Dropdown menu={{ items: menu }} trigger={["click"]} placement="bottomRight">
          <button
            type="button"
            className="vf-shell-account"
            data-testid="current-user"
            aria-label={t("shell.account")}
          >
            <span className="vf-shell-avatar vf-serif" aria-hidden="true">
              {user.display_name.slice(0, 1)}
            </span>
            <span className="vf-shell-who">
              <span>{user.display_name}</span>
              <span className="vf-shell-roles">
                {user.roles.map((role) => (
                  <span key={role}>{t(`role.${role}`)}</span>
                ))}
              </span>
            </span>
          </button>
        </Dropdown>
        {canCreate(user) && (
          <Link
            to="/jobs/new"
            className={pathname === "/jobs/new" ? "vf-btn vf-btn-outline" : "vf-btn vf-btn-primary"}
            aria-current={pathname === "/jobs/new" ? "page" : undefined}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                d="M12 5v14M5 12h14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
            {t("nav.newFilm")}
          </Link>
        )}
      </header>
      <main className="vf-main">
        <Outlet />
      </main>
      <Grain />
    </div>
  );
}
