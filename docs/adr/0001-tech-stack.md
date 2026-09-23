# ADR 0001：技術棧與版本

日期：2026-09-23　狀態：已採用

## 決定

按手冊「推薦技術棧」，所有依賴取 2026-09-23 的最新穩定版（無 beta／rc）。

### 後端（backend/uv.lock 為準）

| 組件 | 版本 |
|---|---|
| Python | 3.13.12（映像預裝 /usr/bin/python3.13） |
| uv | 0.8.17（本環境）；CI 用 astral-sh/setup-uv@v7 |
| FastAPI | 0.141.1 |
| Pydantic / pydantic-settings | 2.13.5 / 2.15.0 |
| SQLAlchemy（async）/ psycopg | 2.0.54 / 3.3.6 |
| Alembic | 1.20.0 |
| Celery / redis-py | 5.6.3 / 8.1.0 |
| structlog | 26.1.0 |
| uvicorn | 0.53.0 |
| boto3 | 1.43.x |
| ruff / mypy / pytest | 0.16.8 / 2.3.1 / 9.1.1 |
| 測試數據庫 | SQLite（aiosqlite 0.22.1） |

### 前端（frontend/pnpm-lock.yaml 為準）

| 組件 | 版本 |
|---|---|
| Node / pnpm | 24.21.0 / 12.6.0 |
| React / React DOM | 19.3.0 |
| TypeScript | 7.0.2 |
| Vite / @vitejs/plugin-react | 8.3.0 / 6.1.1 |
| Ant Design / icons | 6.6.5 / 6.3.4 |
| React Router | 8.4.0 |
| TanStack Query | 5.103.2 |
| i18next / react-i18next | 26.4.2 / 17.0.15 |
| Biome | 2.5.14 |
| Vitest / jsdom | 5.0.1 / 30.1.1 |

### 基礎設施

| 組件 | 版本 |
|---|---|
| PostgreSQL | 18（映像 postgres:18） |
| Valkey | 9（映像 valkey/valkey:9） |
| SeaweedFS | chrislusf/seaweedfs:latest（開發用 S3；不用 MinIO） |
| 後端基礎映像 | ghcr.io/astral-sh/uv:python3.13-trixie-slim + ffmpeg + fonts-noto-cjk |
| GitHub Actions | checkout@v7、setup-uv@v7、setup-node@v7、pnpm/action-setup@v6 |

## 說明

- Lint 用 Biome 而非 ESLint（typescript-eslint 尚不支援 TypeScript 7）。
- Ant Design 預設會在兩個中文字的按鈕間插空格，已在 ConfigProvider 關閉（`button.autoInsertSpace=false`）。
- 後端以 app factory 啟動（`uvicorn --factory app.main:app_factory`），避免 import 時就讀配置與建連線。
- Python 3.13 開啟 `VERIFY_X509_STRICT`，雲端開發環境的代理 CA 不相容；只影響開發腳本，生產不受影響。
