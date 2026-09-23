# CHANGELOG

## 2026-09-23

- 環境檢查（P0）：新增 scripts/check_connectivity.py 與 docs/env-check.md
- 建立項目規則（P1）：CLAUDE.md、.claude/rules/project.md、.claude/settings.json、hooks（session-start、guard 與自測）、skills（/spec、/live-smoke）、agents/reviewer、scripts/cloud-setup.sh
- 保存建設提示詞到 docs/build-prompts.md
- 總體規格（P2）：docs/specs/00-overview.md（待確認）
- 項目骨架（P3）：backend（FastAPI、配置校驗、/healthz、/readyz、structlog、Alembic 初始遷移、Celery ping、ensure-bucket 命令）、frontend（React 19 + TS 7 + Vite 8 + Ant Design 6，繁中 i18n，登入頁與任務列表）、compose.yaml、backend/Dockerfile、CI；docs/specs/01-skeleton.md、docs/adr/0001-tech-stack.md
- scripts/cloud-setup.sh 增加 ffmpeg 安裝
- 模型網關（P4）：直接調用方舟／BytePlus REST 接口，Mock 與真實模式切換，限速、重試、預算、記帳，live 冒煙測試
- 腳本與分鏡（P5）、素材與關鍵幀（P6）、分鏡影片生成（P7）、配音字幕（P8）、FFmpeg 合成（P9）、編排與批量（P10）
- API 與前端（P11）：全部頁面、SSE 進度、Playwright E2E（在真實後端 + Mock 模型上通過）
- 權限、審核與審計（P12）
- 測試與部署（P13）：覆蓋率、pip-audit、pnpm audit、gitleaks、前端 Nginx 映像、compose.prod.yaml、docs/runbook.md
- 新增 scripts/dev-local.sh（無 Docker 的本地全套）、scripts/fetch_fonts.py（字幕字體）
- 規格 12：模型原生聲音（旁白、音效、配樂由 Seedance 直接生成）、Seedance 2.0／2.5 與 Seedream 5.0 能力表（ID 與價格待核對）、
  行銷片改 2.5 長鏡頭、聲音一致選項、TTS 只在國內版提供、GET /meta、API 契約 v1.1、遷移 0003
