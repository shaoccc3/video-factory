import { type ThemeConfig, theme } from "antd";

/** Ant Design 深色主題，色值對應 src/styles/tokens.css（規格 14 第 3 節） */
export const studioTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: "#f0a63a",
    colorInfo: "#7fa3e0",
    colorSuccess: "#5fbf8e",
    colorWarning: "#f0a63a",
    colorError: "#e5484d",
    colorLink: "#f0a63a",
    colorBgBase: "#070c18",
    colorBgLayout: "#070c18",
    colorBgContainer: "#0b1322",
    colorBgElevated: "#111b2e",
    colorBorder: "#26344f",
    colorBorderSecondary: "#1c2842",
    colorText: "#e8ecf3",
    colorTextSecondary: "#a6b0c3",
    colorTextTertiary: "#7f8ba1",
    colorTextDescription: "#7f8ba1",
    borderRadius: 3,
    borderRadiusLG: 4,
    borderRadiusSM: 2,
    controlHeight: 40,
    fontFamily: '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif',
  },
  components: {
    Button: {
      primaryColor: "#1a0f00",
      fontWeight: 700,
      defaultBg: "transparent",
      primaryShadow: "none",
    },
    Layout: { bodyBg: "#070c18", headerBg: "#070c18" },
    Table: {
      headerBg: "#0b1322",
      headerColor: "#7f8ba1",
      rowHoverBg: "#0e1729",
      borderColor: "#1c2842",
    },
    Tabs: { itemSelectedColor: "#e8ecf3", inkBarColor: "#f0a63a", itemHoverColor: "#e8ecf3" },
    Input: {
      colorBgContainer: "#09101e",
      activeBorderColor: "#f0a63a",
      hoverBorderColor: "#3a4a6a",
    },
    InputNumber: {
      colorBgContainer: "#09101e",
      activeBorderColor: "#f0a63a",
      hoverBorderColor: "#3a4a6a",
    },
    Select: { colorBgContainer: "#09101e", optionSelectedBg: "rgba(240,166,58,0.14)" },
    Modal: { contentBg: "#0b1322", headerBg: "#0b1322", footerBg: "#0b1322" },
    Tag: { defaultBg: "#111b2e" },
  },
};
