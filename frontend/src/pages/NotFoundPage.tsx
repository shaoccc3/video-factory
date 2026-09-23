import { Button, Result } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

export function NotFoundPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Result
      status="404"
      title="404"
      subTitle={t("common.notFound")}
      extra={
        <Button type="primary" onClick={() => void navigate("/jobs")}>
          {t("common.backHome")}
        </Button>
      }
    />
  );
}
