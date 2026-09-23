import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n";
import "./styles/tokens.css";
import "./styles/motion.css";
import "./styles/controls.css";
import "./styles/monitor.css";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) {
  throw new Error("找不到 #root 節點");
}

// 自帶字體的 @font-face 宣告（CJK 按 unicode-range 切成數百片）不阻擋首次繪製：
// 先用系統字體顯示，宣告載入後再換字（字體檔本身本來就按需下載）
void import("./styles/fonts");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
