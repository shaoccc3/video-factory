import { Alert, Button, Card, Flex, Form, Input, Select, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import { ApiError } from "../api/client";
import { useLogin } from "../api/hooks";
import { errorMessage } from "../components/ErrorResult";
import { isLanguage, LANGUAGES } from "../i18n";

interface LoginForm {
  email: string;
  password: string;
}

/** 只允許站內相對路徑，避免開放重定向 */
export function safeRedirect(from: string | null): string {
  if (!from?.startsWith("/") || from.startsWith("//") || from.startsWith("/login")) {
    return "/jobs";
  }
  return from;
}

export function LoginPage() {
  const { t, i18n } = useTranslation();
  const login = useLogin();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const onFinish = (values: LoginForm) => {
    login.mutate(values, {
      onSuccess: () => {
        void navigate(safeRedirect(params.get("from")), { replace: true });
      },
    });
  };

  const failed =
    login.error instanceof ApiError && login.error.status === 401
      ? t("login.invalid")
      : login.error
        ? errorMessage(login.error)
        : null;

  return (
    <Flex justify="center" align="center" style={{ minHeight: "100vh", background: "#f5f5f5" }}>
      <Card style={{ width: 360 }}>
        <Flex justify="space-between" align="center">
          <Typography.Title level={3}>{t("login.title")}</Typography.Title>
          <Select
            aria-label={t("language.label")}
            size="small"
            value={i18n.language}
            style={{ width: 110 }}
            onChange={(value: string) => {
              if (isLanguage(value)) void i18n.changeLanguage(value);
            }}
            options={LANGUAGES.map((lng) => ({ value: lng, label: t(`language.${lng}`) }))}
          />
        </Flex>
        {failed && <Alert type="error" showIcon title={failed} style={{ marginBottom: 16 }} />}
        <Form<LoginForm> layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item
            label={t("login.email")}
            name="email"
            rules={[{ required: true, type: "email", message: t("login.emailRequired") }]}
          >
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item
            label={t("login.password")}
            name="password"
            rules={[{ required: true, message: t("login.passwordRequired") }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={login.isPending}>
            {t("login.submit")}
          </Button>
        </Form>
      </Card>
    </Flex>
  );
}
