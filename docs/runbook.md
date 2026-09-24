# 運維手冊（runbook）

適用：video-factory 第一版，部署在公司 Linux 服務器（Docker Compose），不需要 GPU。

## 1. 首次部署

1. 服務器安裝 Docker Engine 與 Compose 插件；開放 80（或 `WEB_PORT`）給內網。
2. 取得代碼：`git clone <倉庫> && cd video-factory`
3. 建 `.env`（參考 `.env.example`，**不要提交**）：
   - `ARK_REGION`：`byteplus`（國際）或 `volcengine`（國內）。`config/models.yaml` 目前按 BytePlus 核對；
     用 `volcengine` 前要先改成火山方舟的模型 ID 與單價（兩區不同），API Key 也要是同一區域的
   - `ARK_API_KEY`：方舟／ModelArk 的 API Key（生產專用那一把，控制台設用量告警）
   - `PROVIDER_MODE=live`（compose.prod.yaml 預設就是 live；只在疊加 compose.prod.yaml 時生效，單獨用 compose.yaml 固定 mock）
   - `POSTGRES_PASSWORD`、`SECRET_KEY`：各用 `openssl rand -hex 32` 生成
   - `S3_ENDPOINT_URL`、`S3_PUBLIC_ENDPOINT_URL`、`S3_BUCKET`、`S3_ACCESS_KEY`、`S3_SECRET_KEY`：公網可訪問的 S3 相容存儲（Seedance 要能拉素材）
   - `TTS_APP_ID`、`TTS_TOKEN`：豆包語音（未配置時旁白為提示音，只適合測試）
   - HTTPS 部署時 `COOKIE_SECURE=true`（預設）；純內網 HTTP 測試時設 `false`，否則瀏覽器不會帶登入 Cookie
   - 選填（留空用預設值；不合法的值會讓 api、worker 啟動失敗）：`DOWNLOAD_ALLOWED_HOSTS`（見第 5 節）、`DOWNLOAD_MAX_BYTES`（位元組）、
     `SEEDANCE_TOTAL_TIMEOUT_S`（秒）、`PRESIGN_EXPIRES_S`（秒，最長 604800）。容器只收到 `compose.yaml`／`compose.prod.yaml` 列出的變量，其他寫在 `.env` 的變量不會生效
4. 填 `config/models.yaml`：各模型的 Model ID、單價、`rpm`、`concurrency`，以控制台為準。
5. 啟動：`docker compose -f compose.yaml -f compose.prod.yaml up -d --build --wait`
   - `migrate` 會執行數據庫遷移並同步 `config/templates/`；`storage-init` 會建立 bucket。
   - worker 啟動時自檢臨時目錄（`/tmp/video-factory-work`，生產掛 `worker-tmp` 卷）：不可寫就直接退出，日誌是「worker 臨時目錄不可寫」，處理見第 5 節。
6. 建立管理員（密碼從環境變量讀，不寫在命令行）：
   ```bash
   read -s ADMIN_PW && export ADMIN_PW
   docker compose -f compose.yaml -f compose.prod.yaml run --rm -e ADMIN_PW api \
     python -m app.cli create-user admin@公司域名 管理員 --roles admin,reviewer,creator --password-env ADMIN_PW
   ```
7. 驗證：`curl http://<服務器>/readyz` 全部 ok（database、valkey、storage、fonts、ffmpeg）；登入前端建一條 quick 任務試跑。

使用內建 SeaweedFS 而不是外部 S3：加 `--profile local-storage`，並自行為 SeaweedFS 的 8333 端口配置公網地址（`S3_PUBLIC_ENDPOINT_URL`），否則圖生影片會失敗。

## 2. 日常操作

| 操作 | 命令 |
|---|---|
| 查看狀態 | `docker compose -f compose.yaml -f compose.prod.yaml ps` |
| 看日誌 | `docker compose ... logs -f api worker`（JSON 日誌，帶 request_id、job_id） |
| 升級版本 | `git pull && docker compose ... up -d --build --wait`（遷移自動執行） |
| 擴 worker | `docker compose ... up -d --scale worker=2`（並發仍受 models.yaml 的 concurrency 限制） |
| 更新模板（覆蓋數據庫裡的修改） | `docker compose ... run --rm api python -m app.cli sync-templates --force` |
| 調整預算 | 前端「管理 → 預算與模型」，或改 models.yaml 的 `budget` 後重啟 |

## 3. 備份與恢復

- 數據庫（每日）：
  `docker compose ... exec -T postgres pg_dump -U video_factory -Fc video_factory > backup/vf-$(date +%F).dump`
- 恢復：
  `docker compose ... exec -T postgres pg_restore -U video_factory -d video_factory --clean --if-exists < backup/vf-日期.dump`
- 對象存儲：外部 S3 用供應商的版本控制或跨區複製；內建 SeaweedFS 備份 `seaweedfs-data` 卷。
- 成片與素材都在對象存儲，數據庫只存引用；兩者要一起備份、一起恢復。

## 4. 更換模型版本

1. 先在控制台體驗中心試片，確認效果與價格。
2. 在 Claude Code 會話用 Plan 模式：「把 video_final 換成 <新 Model ID>，對照文檔檢查能力差異，登記到能力表」。
3. 修改 `config/models.yaml`（對照官方模型列表、價格、接口文件，欄位說明見規格 13）：
   - `id`；單價：影片 `price_per_mtok` 與 `price_per_mtok_by_resolution`，大模型 `price_per_mtok_input`／`price_per_mtok_output`，關鍵幀 `price_per_image`
   - 關鍵幀 `image_sizes`：每個畫幅的尺寸（Seedream 5.0 lite 總像素須在 2560x1440～4096x4096）
   - `capabilities`：解析度、畫幅、時長範圍、fps、`supports_draft`／`supports_audio`／`supports_seed`、圖片 role、參考素材上限、
     `frames_require_adaptive_ratio`（帶首幀時只能 adaptive）、`reference_audio_needs_visual`（參考音頻要搭配參考圖）、
     `dimensions`（官方寬高表，用於估算 token）
4. 在開發環境執行 `/live-smoke`（付費，會先報預估費用）。
5. 合併後在服務器 `git pull` 並重啟 api、worker。

## 5. 常見錯誤

| 現象 | 原因與處理 |
|---|---|
| 任務 `failed`，error_kind = moderation | 輸入或輸出未通過內容審核。修改畫面描述或旁白後「重做」該分鏡；不要反覆重試同樣內容。 |
| error_kind = rate_limit／timeout／server | 平台已自動重試（指數退避）仍失敗。稍後「續跑」；頻繁發生時調低 `concurrency`、`rpm` 或錯峰批量。 |
| `budget_exceeded` | 超出單任務或每日預算。管理員確認後在「預算與模型」調高，或為該用戶設 `daily_budget_cny`，再「續跑」。預設單任務 150 CNY 約可做 140 秒 720p 的 Seedance 2.0 正片；最長 180 秒的培訓片要先調高。 |
| error_code = TaskExpired | Seedance 任務超過平台時限（預設 48 小時）被終止，按超時處理；「續跑」即可。 |
| error_code = asset_url | 存儲無法生成公網地址。設定 `S3_PUBLIC_ENDPOINT_URL`，確認 Seedance 能訪問。 |
| error_code = download_host_denied | 模型返回的結果地址不在白名單。確認域名後在 `.env` 設 `DOWNLOAD_ALLOWED_HOSTS`（JSON 陣列）。它會整個取代預設清單，所以要連同預設域名一起寫：`["*.volces.com","*.bytepluses.com","*.byteimg.com","*.bytecdn.cn","*.volccdn.com","*.byteplusapi.com","*.新域名"]`（預設見 `backend/app/core/settings.py`），只加確認過的域名，不要用 `*`；再 `up -d` 重建 api、worker。 |
| 合成失敗「找不到字體」，或 `/readyz` 的 fonts 不是 ok | 映像構建時抽取字體失敗。重建 backend 映像，看構建日誌裡的 fetch_fonts 步驟。無 Docker 的本地環境執行 `scripts/fetch_fonts.py`（需系統套件 fonts-noto-cjk）。 |
| worker 反覆重啟，日誌「worker 臨時目錄不可寫」 | `worker-tmp` 卷的擁有者不是 app（舊版映像建立的卷、或手動改過）。先 `up -d --build` 用新映像；仍失敗時執行一次 `docker compose -f compose.yaml -f compose.prod.yaml run --rm --no-deps --user root worker chown -R app:app /tmp/video-factory-work`，再 `up -d --wait`。無 Docker 的本地環境（`scripts/dev-local.sh`）：刪掉或修正提示的路徑（預設 `/tmp/vf-local/work`），或設 `VF_LOCAL_DIR` 換目錄。 |
| 合成失敗「成片校驗失敗」 | 成片缺少 AI 標識元數據或編碼不符，屬於系統問題，查看 worker 日誌中的 ffmpeg 錯誤。 |
| `/readyz` 503 | 按返回的 checks 看是 database、valkey、storage、fonts 還是 ffmpeg 不可用。 |
| 前端進度不更新 | 反向代理需對 `/api/` 關閉緩衝（`proxy_buffering off`），前端 Nginx 已配置；外層若還有代理也要關。 |

排查失敗任務時，貼日誌前先刪掉密鑰與帶簽名的 URL。

## 6. 新同事：建立 Claude Code 雲端開發環境

1. claude.ai/code 連接 GitHub，確認 Claude GitHub App 已安裝到本倉庫。
2. 雲朵圖標 → Add cloud environment，名稱 `video-factory-dev`：
   - Network access：Custom，勾選默認套件源清單，Allowed domains 加 `*.bytepluses.com`、`*.volces.com`、`openspeech.bytedance.com`、`production.cloudfront.docker.com`、`docs.byteplus.com`（核對官方文件）
   - Environment variables：`ARK_REGION=byteplus`、`ARK_API_KEY=injected-by-proxy`、`LIVE_BUDGET_CNY=5`
   - Setup script：貼上 `scripts/cloud-setup.sh` 的內容
   - Pro／Max：保存後再編輯，在 API credentials 加方舟密鑰（Bearer，Allowed websites 填對應區域的 ark 域名）
3. 開新會話（倉庫 video-factory、分支 main、環境 video-factory-dev），貼 `docs/build-prompts.md` 的 P0，確認能連到方舟。
4. 本地跑全套（無 Docker 也可）：`scripts/dev-local.sh start`，登入 `admin@example.com`／`admin-pass-123`。
5. 需求變更一律用 `/spec`：先寫 `docs/specs/`，確認後再實作。
