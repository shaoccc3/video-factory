# 09 前端與 E2E（P11）

狀態：已實作　日期：2026-09-23

- 頁面：登入、任務列表、新建任務精靈、任務詳情（分鏡確認、生成進度、成片預覽、調用記錄、審核歷史）、批量、成片庫、素材庫、審核台、用量看板、管理（模板、用戶、預算與模型、審計日誌）。
- 繁體中文為預設，文案集中在 `frontend/src/i18n/locales/`，可切換簡體。
- 按鈕只按後端返回的 `allowed_actions` 顯示；SSE 更新任務緩存。
- 單元測試：Vitest + Testing Library，fetch 全部 mock。
- E2E：`frontend/e2e/marketing.spec.ts`（登入 → 建行銷短影音 → 確認分鏡 → 生成 → 審核通過 → 下載），截圖存 `E2E_SCREENSHOT_DIR`。
  本地用 `scripts/dev-local.sh start` 起全套（SQLite + 本地存儲 + Celery + Mock），CI 的 e2e job 相同。
