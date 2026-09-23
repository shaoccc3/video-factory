import { Alert, Button, Card, Flex, Form, Input, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface LoginForm {
  email: string;
  password: string;
}

export function LoginPage() {
  const { t } = useTranslation();
  const [submitted, setSubmitted] = useState(false);

  return (
    <Flex justify="center" align="center" style={{ minHeight: "100vh", background: "#f5f5f5" }}>
      <Card style={{ width: 360 }}>
        <Typography.Title level={3}>{t("login.title")}</Typography.Title>
        {submitted && (
          <Alert type="info" showIcon title={t("login.notReady")} style={{ marginBottom: 16 }} />
        )}
        <Form<LoginForm> layout="vertical" onFinish={() => setSubmitted(true)} requiredMark={false}>
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
          <Button type="primary" htmlType="submit" block>
            {t("login.submit")}
          </Button>
        </Form>
      </Card>
    </Flex>
  );
}
