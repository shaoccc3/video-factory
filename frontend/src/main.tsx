import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) {
  throw new Error("找不到 #root 節點");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
