import { Flex, Result, Spin } from "antd";
import { createContext, type ReactNode, useContext } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation } from "react-router";
import { isUnauthorized, useMe } from "../api/hooks";
import type { Role, User } from "../api/types";
import { ErrorResult } from "../components/ErrorResult";

const CurrentUserContext = createContext<User | null>(null);

export function useCurrentUser(): User {
  const user = useContext(CurrentUserContext);
  if (!user) throw new Error("useCurrentUser 必須在 AuthGuard 內使用");
  return user;
}

export function hasRole(user: User | null | undefined, role: Role): boolean {
  return Boolean(user?.roles.includes(role));
}

/** 能開新片（建立任務、批量、預估）的角色：創作者或管理員，與後端 CreatorUser 一致 */
export function canCreate(user: User | null | undefined): boolean {
  return hasRole(user, "creator") || hasRole(user, "admin");
}

/** 取得 /auth/me；401 時帶上原路徑導向登入頁 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) {
    return (
      <Flex justify="center" align="center" style={{ minHeight: "100vh" }}>
        <Spin size="large" />
      </Flex>
    );
  }
  if (me.isError) {
    if (isUnauthorized(me.error)) {
      const from = `${location.pathname}${location.search}`;
      return <Navigate to={`/login?from=${encodeURIComponent(from)}`} replace />;
    }
    return <ErrorResult error={me.error} onRetry={() => void me.refetch()} />;
  }
  return <CurrentUserContext value={me.data}>{children}</CurrentUserContext>;
}

/** 角色不符時顯示 403 */
export function RequireRole({ need, children }: { need: Role; children: ReactNode }) {
  const user = useCurrentUser();
  const { t } = useTranslation();
  if (!hasRole(user, need)) {
    return <Result status="403" title="403" subTitle={t("common.forbidden")} />;
  }
  return children;
}
