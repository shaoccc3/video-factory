import { Alert, Button, Result } from "antd";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/client";

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return String(error);
}

export function ErrorResult({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const notFound = error instanceof ApiError && error.status === 404;
  const forbidden = error instanceof ApiError && error.status === 403;
  return (
    <Result
      status={notFound ? "404" : forbidden ? "403" : "error"}
      title={
        notFound ? t("common.notFound") : forbidden ? t("common.forbidden") : t("common.loadFailed")
      }
      subTitle={errorMessage(error)}
      extra={
        onRetry ? (
          <Button onClick={onRetry} key="retry">
            {t("common.retry")}
          </Button>
        ) : undefined
      }
    />
  );
}

/** 表單或操作失敗時的行內錯誤 */
export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  return <Alert type="error" showIcon title={errorMessage(error)} style={{ marginBottom: 16 }} />;
}
