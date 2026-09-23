# 11 測試與部署（P13）

狀態：已實作　日期：2026-09-23

- 測試：後端 pytest（覆蓋率報告 `--cov`），前端 Vitest，E2E Playwright。
- 安全：`pip-audit`、`pnpm audit --prod`、gitleaks 密鑰掃描、上傳按內容校驗、外部下載 https + 域名白名單 + 大小上限、guard hook。
- 映像：`backend/Dockerfile`（uv Python 3.13 slim + ffmpeg + 思源黑體繁中，非 root）、`frontend/Dockerfile`（Node 24 構建，Nginx 提供靜態文件並代理 /api，SSE 不緩衝）。
- `compose.prod.yaml`：必填變量缺少即報錯、資源限制、日誌輪轉、數據卷、健康檢查、預設外部 S3。
- 運維文件：`docs/runbook.md`。
