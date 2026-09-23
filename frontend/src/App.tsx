import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntdApp, ConfigProvider } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createBrowserRouter,
  createMemoryRouter,
  Navigate,
  type RouteObject,
  RouterProvider,
} from "react-router";
import { ApiError } from "./api/client";
import { queryKeys } from "./api/hooks";
import { AuthGuard, RequireRole } from "./auth/auth";
import { AppShell } from "./components/studio/AppShell";
import { usePauseAnimationsWhenHidden } from "./hooks/motion";
import { ANTD_LOCALES, DEFAULT_LANGUAGE, isLanguage } from "./i18n";
import { AssetsPage } from "./pages/AssetsPage";
import { AdminPage } from "./pages/admin/AdminPage";
import { BatchDetailPage, BatchesPage } from "./pages/BatchesPage";
import { JobDetailPage } from "./pages/JobDetailPage";
import { JobsPage } from "./pages/JobsPage";
import { JobWizardPage } from "./pages/JobWizardPage";
import { LibraryPage } from "./pages/LibraryPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ReviewDetailPage, ReviewsPage } from "./pages/ReviewsPage";
import { UsagePage } from "./pages/UsagePage";
import { studioTheme } from "./theme";

export const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
    element: (
      <AuthGuard>
        <AppShell />
      </AuthGuard>
    ),
    children: [
      { index: true, element: <Navigate to="/jobs" replace /> },
      { path: "jobs", element: <JobsPage /> },
      { path: "jobs/new", element: <JobWizardPage /> },
      { path: "jobs/:id", element: <JobDetailPage /> },
      { path: "batches", element: <BatchesPage /> },
      { path: "batches/:id", element: <BatchDetailPage /> },
      { path: "library", element: <LibraryPage /> },
      { path: "assets", element: <AssetsPage /> },
      {
        path: "reviews",
        element: (
          <RequireRole need="reviewer">
            <ReviewsPage />
          </RequireRole>
        ),
      },
      {
        path: "reviews/:id",
        element: (
          <RequireRole need="reviewer">
            <ReviewDetailPage />
          </RequireRole>
        ),
      },
      { path: "usage", element: <UsagePage /> },
      {
        path: "admin",
        element: (
          <RequireRole need="admin">
            <AdminPage />
          </RequireRole>
        ),
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

/**
 * 任何請求回 401（會話過期）時讓 /auth/me 重新取得，AuthGuard 會據此導向登入頁。
 * /auth/me 本身的 401 不再觸發，避免循環。
 */
export function createQueryClient(): QueryClient {
  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      const me = client.getQueryState(queryKeys.me);
      if (me?.status === "success") void client.invalidateQueries({ queryKey: queryKeys.me });
    }
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        retry: (count, error) =>
          !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
        refetchOnWindowFocus: false,
      },
    },
  });
  return client;
}

interface AppProps {
  /** 測試用：以記憶路由啟動在指定路徑 */
  initialPath?: string;
  /** 測試用：注入 QueryClient */
  queryClient?: QueryClient;
}

export function App({ initialPath, queryClient: injected }: AppProps) {
  const { i18n } = useTranslation();
  const [queryClient] = useState(() => injected ?? createQueryClient());
  const [router] = useState(() =>
    initialPath === undefined
      ? createBrowserRouter(routes)
      : createMemoryRouter(routes, { initialEntries: [initialPath] }),
  );
  const language = isLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;
  usePauseAnimationsWhenHidden();

  return (
    <ConfigProvider
      locale={ANTD_LOCALES[language]}
      theme={studioTheme}
      button={{ autoInsertSpace: false }}
    >
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </AntdApp>
    </ConfigProvider>
  );
}
