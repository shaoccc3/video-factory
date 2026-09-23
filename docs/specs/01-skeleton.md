# 01 項目骨架（P3）

狀態：已確認（沿用 00-overview 的確認；待確認問題採用 00 第 11 節的建議預設）　日期：2026-09-23

## 目標

搭起可運行、可測試、可部署的空殼：後端 API、Worker、前端、compose、CI。業務功能從 P4 開始。

## 不做的事

模型網關、業務表（P4 起按階段新增遷移）、真實登入邏輯（P12）、任何付費調用。

## 設計

- **後端**（`backend/`）：Python 3.13、uv（`uv.lock` 提交，開發依賴在 `[dependency-groups]`）
  - FastAPI + Pydantic v2 + pydantic-settings；`app/core/settings.py` 讀環境變量
  - `app/core/models_config.py`：啟動時載入 `config/models.yaml`，Pydantic 校驗，錯誤訊息指出欄位路徑，啟動失敗
  - SQLAlchemy 2.0 async + psycopg 3；Alembic（async env）；初始遷移建 `users` 表（00 規格的第一張表）
  - structlog JSON 日誌；中間件為每個請求生成／沿用 `X-Request-ID` 並綁定到日誌上下文
  - `GET /healthz` → `{"status":"ok"}`；`GET /readyz` → 檢查 PostgreSQL（`SELECT 1`）、Valkey（`PING`）、對象存儲（`HeadBucket`），任一失敗回 503 並列出各項結果
- **Worker**：Celery 5.6，broker 與結果後端為 Valkey；任務 `ping` → `"pong"`；單元測試用 eager
- **前端**（`frontend/`）：Node 24、pnpm（`packageManager` 精確版本）、React 19 + TS 7 + Vite 8 + Ant Design 6 + React Router 8 + TanStack Query；react-i18next（zh-TW 預設，Ant Design 語系同步）；頁面：登入、空任務列表；Biome、tsc、Vitest
- **基礎設施**：`compose.yaml`（api、worker、postgres:18、valkey:9、seaweedfs、seaweedfs-init 建 bucket、migrate 跑 Alembic）；皆有 healthcheck；`backend/Dockerfile` 基於 uv 官方 Python 3.13 slim 映像，裝 ffmpeg，非 root 運行；`.env.example` 只列變量名
- **配置**：`config/models.yaml` 預設 `region: byteplus`，模型 ID 與單價為佔位值
- **CI**：`.github/workflows/ci.yml`：backend、frontend、smoke 三個 job

## 任務清單

- [x] 後端骨架、配置校驗、健康檢查、日誌、Alembic 初始遷移
- [x] Celery worker 與 ping 任務
- [x] 前端骨架、i18n、登入頁與任務列表頁
- [x] compose.yaml、Dockerfile、.env.example
- [x] CI workflow
- [x] docs/adr/0001-tech-stack.md、更新 CLAUDE.md 與 CHANGELOG

## 驗收清單

- [ ] `cd backend && uv run ruff check && uv run ruff format --check && uv run mypy && uv run pytest` 全部通過
- [ ] `cd frontend && pnpm biome ci . && pnpm tsc --noEmit && pnpm vitest run && pnpm build` 全部通過
- [ ] `docker compose up -d --wait` 後 `/healthz`、`/readyz` 回 200（本雲端環境拉不到映像，改由 CI smoke job 驗證）
- [ ] CI 三個 job 全綠

## 風險

- 本環境無法拉 Docker 映像，compose 只能靠 CI 驗證。
- TypeScript 7 較新，若周邊工具不相容，記錄在 ADR。
