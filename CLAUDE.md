# video-factory

公司內部的自動化影音生成平台：輸入主題與素材，自動產出腳本、分鏡、影片、配音、字幕，並合成成片。
項目規則見 .claude/rules/project.md；每個階段的規格在 docs/specs/。

## 環境（Claude Code 雲端會話）
- Python 3.13（uv 管理，版本見 .python-version；用映像預裝的 /usr/bin/python3.13，不要下載其他 Python）
- Node 24 + pnpm（由環境的 setup script 安裝）；node --version 不是 v24 時先停下告訴我
- Docker 由 SessionStart hook 自動啟動；數據庫與緩存一律用 compose.yaml 的 postgres:18、valkey:9，不用映像預裝的 PostgreSQL 16 與 Redis
- Playwright 用預裝 Chromium（/opt/pw-browsers/chromium），不要執行 playwright install

## 運行
- 全套：docker compose up -d --build --wait（固定 Mock；前端 :8080、API :8000；沒有預設帳號，建管理員見 README）；生產疊加 compose.prod.yaml，見 docs/runbook.md
- 無 Docker 的本地全套（SQLite + 本地存儲 + Celery + Mock）：scripts/dev-local.sh start|stop（先檢查 ffmpeg、字體、前端依賴，全部就緒才返回，失敗時非零退出）
- 字幕字體（首次，需系統套件 fonts-noto-cjk）：cd backend && uv run --with fonttools python ../scripts/fetch_fonts.py
- 後端：cd backend && uv run uvicorn --factory app.main:app_factory --reload
- 遷移：cd backend && uv run alembic upgrade head
- Worker：cd backend && uv run celery -A app.workers worker -l info
- 前端：cd frontend && pnpm dev

## 檢查（提交前全部通過）
- 後端：cd backend && uv run ruff check && uv run ruff format --check && uv run mypy && uv run pytest
- 前端：cd frontend && pnpm biome ci . && pnpm tsc --noEmit && pnpm vitest run && pnpm build
- E2E（改動前端或流水線時）：scripts/dev-local.sh start && (cd frontend && pnpm e2e)，截圖在 /tmp/e2e/
- 單元測試一律用 MockProvider，禁止調用真實 API

## 付費調用
- 真實 API（pytest -m live、真實生成）只在我輸入 /live-smoke 或當前訊息明確要求時執行
- 執行前先報預估費用，超過環境變量 LIVE_BUDGET_CNY 就停下問我

## 工作方式
- 階段性需求用 /spec：先寫 docs/specs/，我確認後再實作
- 每完成一個階段，更新 docs/CHANGELOG.md 與本文件的運行、檢查命令
- 不要把密鑰、帶簽名的 URL 寫進對話、日誌或文件
