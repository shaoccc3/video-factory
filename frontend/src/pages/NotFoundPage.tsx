import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import "./notfound.css";

/** 測試色條：深藍色調，最後一條是琥珀，呼應強調色 */
const BARS = ["#c7cedb", "#8fa3c4", "#5d7fb4", "#3c5a8f", "#2a3f6a", "#1a2848", "#b9853d"];
const PLUGE = ["#0a1224", "#e8ecf3", "#16213a", "#070c18", "#1c2842"];

/** 404：「NO SIGNAL」字卡（規格 14） */
export function NotFoundPage() {
  const { t } = useTranslation();
  const location = useLocation();
  return (
    <section className="vf-nosignal vf-rise" aria-labelledby="vf-nosignal-title">
      <div className="vf-nosignal-screen" aria-hidden="true">
        <div className="vf-nosignal-bars">
          {BARS.map((color) => (
            <span key={color} style={{ background: color }} />
          ))}
        </div>
        <div className="vf-nosignal-pluge">
          {PLUGE.map((color) => (
            <span key={color} style={{ background: color }} />
          ))}
        </div>
        <span className="vf-nosignal-grain" />
        <span className="vf-nosignal-roll" />
      </div>
      <div className="vf-nosignal-card">
        <span className="vf-mono vf-nosignal-tag">{t("mono.noSignal")}</span>
        <h1 id="vf-nosignal-title" className="vf-serif">
          {t("notFound.title")}
        </h1>
        <p className="vf-muted">{t("common.notFound")}</p>
        <code className="vf-mono vf-nosignal-path">{location.pathname}</code>
        <Link to="/" className="vf-btn vf-btn-primary vf-btn-lg">
          {t("common.backHome")}
        </Link>
      </div>
    </section>
  );
}
