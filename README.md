# video-factory

公司內部的自動化影音生成平台：輸入主題與素材，自動產出腳本、分鏡、影片（Seedance）、關鍵幀（Seedream）、配音、字幕，並合成帶 AI 標識的成片；經審核後下載。

- 三類影片：行銷短影音（9:16，15～30 秒）、圖片／文字轉短片（單鏡頭，可批量）、培訓講解片（16:9，1～3 分鐘）
- 流程：選模板 → 大模型寫分鏡 → 人工確認（看成本預估）→ 生成 → 配音字幕 → FFmpeg 合成 → 審核 → 成片庫
- 技術：FastAPI + SQLAlchemy + Celery（Valkey）+ PostgreSQL + S3 相容存儲 + FFmpeg；前端 React + Ant Design

## 快速開始

```bash
# 開發（Mock 模型，不產生費用）
docker compose up -d --wait         # 前端 http://localhost:8080
# 或沒有 Docker 時
scripts/dev-local.sh start          # 前端 http://localhost:5173，admin@example.com / admin-pass-123
```

- 項目說明與命令：[CLAUDE.md](CLAUDE.md)
- 總體規格與各階段規格：[docs/specs/](docs/specs/)
- API 契約：[docs/specs/api-contract.md](docs/specs/api-contract.md)
- 部署與運維：[docs/runbook.md](docs/runbook.md)
