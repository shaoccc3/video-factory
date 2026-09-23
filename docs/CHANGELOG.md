# CHANGELOG

## 2026-09-23

- 環境檢查（P0）：新增 scripts/check_connectivity.py 與 docs/env-check.md
- 建立項目規則（P1）：CLAUDE.md、.claude/rules/project.md、.claude/settings.json、hooks（session-start、guard 與自測）、skills（/spec、/live-smoke）、agents/reviewer、scripts/cloud-setup.sh
- 保存建設提示詞到 docs/build-prompts.md
- 總體規格（P2）：docs/specs/00-overview.md（待確認）
- 項目骨架（P3）：backend（FastAPI、配置校驗、/healthz、/readyz、structlog、Alembic 初始遷移、Celery ping、ensure-bucket 命令）、frontend（React 19 + TS 7 + Vite 8 + Ant Design 6，繁中 i18n，登入頁與任務列表）、compose.yaml、backend/Dockerfile、CI；docs/specs/01-skeleton.md、docs/adr/0001-tech-stack.md
- scripts/cloud-setup.sh 增加 ffmpeg 安裝
