import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfigProvider } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createBrowserRouter, createMemoryRouter, Navigate, RouterProvider } from "react-router";
import { ANTD_LOCALES, DEFAULT_LANGUAGE, isLanguage } from "./i18n";
import { AppLayout } from "./pages/AppLayout";
import { JobsPage } from "./pages/JobsPage";
import { LoginPage } from "./pages/LoginPage";

const routes = [
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/jobs" replace /> },
      { path: "jobs", element: <JobsPage /> },
    ],
  },
];

interface AppProps {
  /** 測試用：以記憶路由啟動在指定路徑 */
  initialPath?: string;
}

export function App({ initialPath }: AppProps) {
  const { i18n } = useTranslation();
  const [queryClient] = useState(() => new QueryClient());
  const [router] = useState(() =>
    initialPath === undefined
      ? createBrowserRouter(routes)
      : createMemoryRouter(routes, { initialEntries: [initialPath] }),
  );
  const language = isLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;

  return (
    <ConfigProvider locale={ANTD_LOCALES[language]} button={{ autoInsertSpace: false }}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ConfigProvider>
  );
}
