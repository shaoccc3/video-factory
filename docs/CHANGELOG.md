# CHANGELOG

## 2026-09-24

- 部署就緒修正（從全新 clone 試跑發現）：
  - 生產 worker 的 `worker-tmp` 卷擁有者是 root、app 用戶寫不進去，首幀、影片下載與合成全部失敗——
    Dockerfile 先建 `/tmp/video-factory-work` 並交給 app；worker 啟動時自檢臨時目錄，不可寫就直接退出並寫明原因
  - `/readyz` 新增 fonts、ffmpeg 檢查；worker 啟動時缺字體或 ffmpeg 記錯誤日誌
  - compose 轉發 `DOWNLOAD_ALLOWED_HOSTS`、`DOWNLOAD_MAX_BYTES`、`SEEDANCE_TOTAL_TIMEOUT_S`、`PRESIGN_EXPIRES_S`；
    設定忽略空字串環境變量（留空時用預設值），這幾項加上範圍校驗（不合法時啟動失敗）；
    下載白名單只接受域名或 *.域名（至少兩段），拒絕 `*`、`*.com`、常見公共後綴、IP、localhost、內部域與通配 DNS，防止白名單被設成形同虛設
  - 單獨用 compose.yaml 時固定 `PROVIDER_MODE=mock`（.env 的 PROVIDER_MODE 只在疊加 compose.prod.yaml 時生效），避免誤用生產 .env 產生費用；
    開發容器不再轉發 ARK_API_KEY、TTS_*（Mock 用不到）
  - `scripts/dev-local.sh start` 先檢查端口、ffmpeg、字體、前端依賴，等 API（/readyz）、worker、前端都就緒才返回；
    進程提前退出或逾時會印日誌、只停本次啟動的進程並非零退出。`stop` 只對頂層進程送 TERM（不再直接殺 celery pool 子進程，
    停止由約 15 秒縮短到約 5 秒）；pid 目錄記錄啟動它的 checkout，別的仍在跑的 checkout 執行 stop 不會動到（回非零並指向正確的 stop），
    記錄的 checkout 已被刪除時照 pid 文件清理，記錄的進程都已停止時直接清掉過期記錄；沒有 checkout 記錄（舊版腳本啟動）的不處理；
    過期 pid 要命令列與啟動參數完全一致（ps -ww，不受 COLUMNS 截斷）；上一套還有記錄的進程在跑時 start 拒絕；
    兜底搜尋只認（任一）python 執行本 checkout 的 .venv/bin/uvicorn／celery、node 執行本 checkout 的 vite、參數與 start 一致的進程，
    不會誤殺 Docker 容器、其他 checkout 或提到這些路徑的 shell；本機請求不走 http 代理；遷移失敗時提示改用獨立的 VF_LOCAL_DIR
  - README 快速開始補齊兩種方式的前置條件、字體與建立管理員；runbook 補區域、選填變量、卷權限與白名單說明

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
- 規格 13：按 BytePlus 官方文件核對 models.yaml——補齊 seed-2-0-lite-260428、seedream-5-0-lite-260128、
  dreamina-seedance-2-5-260628；影片改用官方牌價（2.0 fast 5.6、2.0 7.0／1080p 7.7、2.5 10.70／1080p 11.7 USD／百萬 token），
  大模型輸入／輸出分價，影片 token 用官方寬高表；Seedance 2.x 不送 seed、2.5 帶首幀送 ratio=adaptive、
  首幀與參考音頻不混用、2.0 不只送參考音頻、處理 expired 狀態；Seedream 關鍵幀改用 2K 尺寸、不送 seed、輸出 PNG；
  大模型不送 user；預算示例值改為 150／600 CNY；管理頁顯示分價摘要，API 契約 v1.2；
  審查後補：尾幀按 JPEG 存、配置載入時校驗關鍵幀尺寸與影片單價、2.0 用不上參考音頻時不再先等第一鏡、runbook 更新
- 規格 14：介面改版「剪輯台」（深藍・電影感，琥珀單一強調色、膠片顆粒、等寬時間碼與襯線標題，自帶字體、減少動態效果降級）——
  片場首頁（放映區、快速開片、片場底片、放映室精選）、開新片場記板（構圖預覽、即時預估、打板動畫）、
  分鏡表（監看＋運鏡示意＋字幕、鏡頭編輯自動儲存、剪輯時間軸、首幀預覽、管理員技術細節抽屜）、
  其他狀態任務頁、全部任務、放映室與燈箱（?play=）、素材印樣表與抽屜、批量（分段進度、場記板對話框、底片網格）、
  審核單、用量（dataviz 準則的長條圖與比例表）、管理、登入頁、NO SIGNAL 404；
  後端：JobSummary.preview_asset_id／runtime_s、GET /jobs 多狀態與 sort、POST /jobs/estimate、
  首幀預覽 POST /jobs/{id}/scenes/{scene_id}/keyframe-preview（Celery 步驟、開拍沿用、生成中不能確認或重寫）、
  JobDetail.shot_duration_s；API 契約 v1.3，無數據庫遷移；E2E 改走新流程並截取全部頁面
