import { Form, Input, Select } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import { ApiError } from "../api/client";
import { useLogin } from "../api/hooks";
import { errorMessage } from "../components/ErrorResult";
import { formatTimecode, useNow } from "../hooks/motion";
import { isLanguage, LANGUAGES } from "../i18n";
import "./login.css";

interface LoginForm {
  email: string;
  password: string;
}

/** 只允許站內相對路徑，避免開放重定向 */
export function safeRedirect(from: string | null): string {
  if (!from?.startsWith("/") || from.startsWith("//") || from.startsWith("/login")) {
    return "/";
  }
  return from;
}

/** 左側的全幅靜幀：純 CSS 繪製的黎明山谷（不用照片，也不放真人），加片名字卡與顆粒 */
function OpeningStill() {
  const { t } = useTranslation();
  const now = useNow();
  return (
    <section className="vf-login-still" aria-label={t("login.stillLabel")}>
      <div className="vf-login-scene" aria-hidden="true">
        <span className="vf-login-sky" />
        <span className="vf-login-sun" />
        <span className="vf-login-ridge vf-login-ridge-1" />
        <span className="vf-login-mist vf-login-mist-1" />
        <span className="vf-login-ridge vf-login-ridge-2" />
        <span className="vf-login-mist vf-login-mist-2" />
        <span className="vf-login-ridge vf-login-ridge-3" />
      </div>
      <span className="vf-login-grain" aria-hidden="true" />
      <span className="vf-login-bar vf-login-bar-top" aria-hidden="true" />
      <span className="vf-login-bar vf-login-bar-bottom" aria-hidden="true" />
      <div className="vf-login-overlay">
        <span className="vf-mono vf-login-meta">
          VF STUDIO · <span role="timer">TC {formatTimecode(now)}</span>
        </span>
        <div className="vf-login-card">
          <span className="vf-label">ROLL 01 · SCENE 01 · TAKE 1</span>
          <h1 className="vf-serif">{t("app.name")}</h1>
          <p>{t("login.tagline")}</p>
        </div>
      </div>
    </section>
  );
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
    <main className="vf-login">
      <OpeningStill />
      <section className="vf-login-panel" aria-labelledby="vf-login-title">
        <div className="vf-login-form vf-rise">
          <div className="vf-login-head">
            <span className="vf-label">SIGN IN</span>
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
          </div>
          <h2 id="vf-login-title" className="vf-serif">
            {t("login.heading")}
          </h2>
          <p className="vf-muted">{t("login.lead")}</p>
          {failed && (
            <div className="vf-callout vf-callout-error" role="alert">
              {failed}
            </div>
          )}
          <Form<LoginForm> layout="vertical" onFinish={onFinish} requiredMark={false}>
            <Form.Item
              label={t("login.email")}
              name="email"
              rules={[{ required: true, type: "email", message: t("login.emailRequired") }]}
            >
              <Input autoComplete="username" size="large" />
            </Form.Item>
            <Form.Item
              label={t("login.password")}
              name="password"
              rules={[{ required: true, message: t("login.passwordRequired") }]}
            >
              <Input.Password autoComplete="current-password" size="large" />
            </Form.Item>
            <button
              type="submit"
              className="vf-btn vf-btn-primary vf-btn-lg vf-login-submit"
              disabled={login.isPending}
              aria-busy={login.isPending}
            >
              {t("login.submit")}
            </button>
          </Form>
          <p className="vf-note">{t("login.note")}</p>
        </div>
      </section>
    </main>
  );
}
