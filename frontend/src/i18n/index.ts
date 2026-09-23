import type { Locale } from "antd/es/locale";
import zhCN from "antd/locale/zh_CN";
import zhTW from "antd/locale/zh_TW";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zhCNMessages from "./locales/zh-CN.json";
import zhTWMessages from "./locales/zh-TW.json";

export const LANGUAGES = ["zh-TW", "zh-CN"] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = "zh-TW";

export const ANTD_LOCALES: Record<Language, Locale> = {
  "zh-TW": zhTW,
  "zh-CN": zhCN,
};

export function isLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value);
}

void i18n.use(initReactI18next).init({
  resources: {
    "zh-TW": { translation: zhTWMessages },
    "zh-CN": { translation: zhCNMessages },
  },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false },
});

export default i18n;
