# video-factory

公司內部的自動化影音生成平台：輸入主題與素材，自動產出腳本、分鏡、影片（Seedance）、關鍵幀（Seedream）、配音、字幕，並合成帶 AI 標識的成片；經審核後下載。

- 三類影片：行銷短影音（9:16，15～30 秒）、圖片／文字轉短片（單鏡頭，可批量）、培訓講解片（16:9，1～3 分鐘）
- 流程：選模板 → 大模型寫分鏡 → 人工確認（看成本預估）→ 生成 → 配音字幕 → FFmpeg 合成 → 審核 → 成片庫
- 技術：FastAPI + SQLAlchemy + Celery（Valkey）+ PostgreSQL + S3 相容存儲 + FFmpeg；前端 React + Ant Design

## 快速開始

以下兩種方式都固定用 Mock 模型，不產生費用；`.env` 裡的 `ARK_API_KEY`、`PROVIDER_MODE` 不會讓它們調用真實接口。
真實生成（會計費）要用生產疊加 `compose.prod.yaml`，並準備公網可訪問的對象存儲，步驟見 [docs/runbook.md](docs/runbook.md)。

### A. Docker（和正式環境同一套映像）

```bash
docker compose up -d --build --wait     # 前端 http://localhost:8080，API http://localhost:8000
# 沒有預設帳號：建立管理員（密碼從環境變量讀，不寫在命令行）
read -s ADMIN_PW && export ADMIN_PW
docker compose run --rm -e ADMIN_PW api \
  python -m app.cli create-user admin@example.com 管理員 --roles admin,reviewer,creator --password-env ADMIN_PW
```

映像裡已有 ffmpeg 與字幕字體；`curl http://localhost:8000/readyz` 應全部 ok。

### B. 沒有 Docker（SQLite + 本地存儲 + Celery）

需要 Python 3.13 與 uv、Node 24 與 pnpm，以及系統套件 ffmpeg、fonts-noto-cjk（Debian／Ubuntu：`sudo apt-get install ffmpeg fonts-noto-cjk`）。

```bash
(cd backend && uv sync && uv run --with fonttools python ../scripts/fetch_fonts.py)   # 依賴與字幕字體（首次）
(cd frontend && pnpm install)
scripts/dev-local.sh start    # 前端 http://localhost:5173，admin@example.com / admin-pass-123
scripts/dev-local.sh stop
```

`start` 會先檢查端口、ffmpeg、字體、前端依賴，等 API、worker、前端都就緒才返回（預設最多 90 秒，可用 `READY_TIMEOUT_S` 調整）；缺東西或啟動失敗時會說明原因、印出日誌並停止本次啟動的進程。數據庫、存儲與日誌放在 `/tmp/vf-local`（可用 `VF_LOCAL_DIR` 換目錄），重啟後保留；`stop` 只會停本 checkout 啟動的進程。

## 文件

- 項目說明與命令：[CLAUDE.md](CLAUDE.md)
- 總體規格與各階段規格：[docs/specs/](docs/specs/)
- API 契約：[docs/specs/api-contract.md](docs/specs/api-contract.md)
- 部署與運維：[docs/runbook.md](docs/runbook.md)
