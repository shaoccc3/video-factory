# 00 總體規格：video-factory 第一版（公司內部工具）

狀態：已確認（2026-09-23；第 11 節問題暫用建議預設）　日期：2026-09-23

## 1. 目標與範圍

用 BytePlus ModelArk（國際版，預設）或火山方舟（國內版）的 API，自動生成三類影片：

| 影片類型 | 規格 | 流水線差異 |
|---|---|---|
| 行銷／商品短影音 `marketing` | 9:16，15～30 秒，3～6 個鏡頭 | 商品圖作首幀或參考圖，強調品牌一致 |
| 圖片／文字轉短片 `quick` | 單鏡頭，可批量 | 跳過腳本，直接圖生影片或文生影片 |
| 知識／培訓講解片 `training` | 16:9，1～3 分鐘 | 以 TTS 旁白為主軸，影片按旁白時長對齊，字幕必選 |

流水線：

```
選模板與輸入 → 大模型寫腳本與分鏡（JSON）→ 人工確認分鏡 → 可選 Seedream 關鍵幀
→ Seedance 按分鏡生成片段（非同步任務）→ TTS 配音或模型原生音頻 → 字幕
→ FFmpeg 合成（拼接、轉場、字幕、Logo、AI 生成標識）→ 審核 → 成片庫
```

使用者：內部員工 **10 人以內**；角色為管理員 `admin`、創作者 `creator`、審核者 `reviewer`（一人可有多個角色）。

**不做的事（第一版）**：對外開放、計費收款、GPU 自部署模型、Remotion 模板動畫、去除 AI 標識、飛書／企業微信登入（只預留接口）、多租戶。

## 2. 區域與配置

- `ARK_REGION`：`byteplus`（預設）或 `volcengine`；代碼只有一個區域開關，SDK 分別為 `byteplussdkarkruntime` 與 `volcenginesdkarkruntime`。
- 模型 ID、單價、限速只在 `config/models.yaml`；影片模板在 `config/templates/`。
- 國際版處理在境外：大陸素材或個人信息改用國內版（見數據出境規則）。

## 3. 數據模型

所有表帶 `id`（UUID）、`created_at`、`updated_at`；金額用 `Numeric(12,4)`，幣種統一 `CNY`（國際版按配置匯率換算，並保留原幣金額）。

| 表 | 主要欄位 | 說明 |
|---|---|---|
| `users` | email、display_name、password_hash、roles（陣列）、is_active、daily_budget_cny（可空＝用預設） | 本地帳號；預留 `auth_provider`、`external_id` |
| `templates` | key、name、video_type、ratio、duration_range、shot_range、audio_mode（`tts`／`native`／`none`）、prompt_template、style_prefix、subtitle_required、is_active、version | 管理員維護；任務引用時快照參數 |
| `jobs` | owner_id、template_id、template_snapshot（JSON）、title、inputs（JSON：主題、變量）、status、region、seed、continuous_shots、draft_mode、budget_cny、estimated_cost_cny、actual_cost_cny、error_code、error_message、batch_id | 一條影片 = 一個任務 |
| `batches` | owner_id、template_id、source_csv_asset_id、total、max_parallel、status | CSV 批量建立 |
| `scenes` | job_id、index、narration、visual_prompt、shot_type、camera_move、duration_s、needs_first_frame、screen_text、first_frame_asset_id、ref_asset_ids、status、video_asset_id、last_frame_asset_id、audio_asset_id、attempt | 分鏡，可單獨重做 |
| `assets` | owner_id、kind（`logo`／`product`／`font`／`bgm`／`keyframe`／`clip`／`last_frame`／`voice`／`subtitle`／`final`／`cover`／`csv`）、storage_key、mime、size、sha256、width、height、duration_s、tags、source（`upload`／`generated`） | 文件名一律重新生成 |
| `generation_calls` | job_id、scene_id、provider（`llm`／`seedream`／`seedance`／`tts`）、model_id、remote_task_id、request_summary（去敏 JSON）、status、error_code、error_kind（`moderation`／`rate_limit`／`timeout`／`server`／`client`）、started_at、finished_at、attempt | 每次外部調用一行 |
| `cost_ledger` | generation_call_id、job_id、user_id、model_id、usage（JSON，如 completion_tokens）、unit_price、amount_cny、estimated（布爾） | 只增不改 |
| `reviews` | job_id、reviewer_id、decision（`approved`／`rejected`）、checklist（JSON）、reason、return_to（`storyboard`） | 審核記錄 |
| `audit_logs` | actor_id、action、target_type、target_id、detail（JSON，去敏）、ip、user_agent | 登入、建任務、審核、下載、配置變更 |

## 4. 任務狀態機

```
draft → scripting → storyboard_ready → generating → composing → in_review → approved
                                                                         ↘ rejected → (退回) storyboard_ready
任一進行中狀態 → failed | cancelled | budget_exceeded
```

| 狀態 | 進入條件 | 可重試／續跑點 |
|---|---|---|
| `draft` | 建立任務、輸入通過校驗 | — |
| `scripting` | 用戶提交；`quick` 類型直接由輸入生成單個分鏡，跳過大模型 | 大模型失敗可重試整步 |
| `storyboard_ready` | 分鏡 JSON 校驗通過並入庫；**確認前不得調用 Seedance** | 可編輯、可重新生成腳本 |
| `generating` | 用戶確認分鏡且預估成本未超預算；依次：關鍵幀（需要時）→ 分鏡影片 → TTS／字幕 | 單分鏡重做；從首個未成功分鏡續跑 |
| `composing` | 全部分鏡 `succeeded` 且音頻就緒 | 合成失敗可整步重跑（冪等） |
| `in_review` | 成片與封面入庫，AI 標識校驗通過 | — |
| `approved` | 審核者通過；成片才可下載 | 終態 |
| `rejected` | 審核者退回並填原因；創作者可回到 `storyboard_ready` 修改 | — |
| `failed` | 不可重試錯誤、或重試耗盡 | 從失敗點續跑 |
| `cancelled` | 用戶取消；同步取消未完成的 Seedance 任務 | 終態 |
| `budget_exceeded` | 單任務或每日預算超限；停止後續步驟 | 管理員調高預算後可續跑 |

分鏡狀態：`pending → keyframe → queued → running → succeeded | failed | cancelled`。

## 5. 後端 API（`/api/v1`，FastAPI）

| 分組 | 接口 |
|---|---|
| 健康 | `GET /healthz`、`GET /readyz` |
| 認證 | `POST /auth/login`、`POST /auth/logout`、`GET /auth/me` |
| 用戶（admin） | `GET/POST /users`、`PATCH /users/{id}` |
| 模板 | `GET /templates`、`GET /templates/{id}`；admin：`POST/PATCH /templates` |
| 任務 | `POST /jobs`、`GET /jobs`（篩選：狀態、類型、擁有者）、`GET /jobs/{id}`、`POST /jobs/{id}/submit`、`POST /jobs/{id}/confirm-storyboard`、`POST /jobs/{id}/cancel`、`POST /jobs/{id}/resume`、`GET /jobs/{id}/estimate`、`GET /jobs/{id}/events`（SSE） |
| 分鏡 | `PATCH /jobs/{id}/scenes/{sid}`、`POST /jobs/{id}/scenes/{sid}/regenerate`（`keyframe`／`video`） |
| 批量 | `POST /batches`（CSV）、`GET /batches/{id}` |
| 素材 | `POST /assets`（上傳）、`GET /assets`、`GET /assets/{id}`、`DELETE /assets/{id}`、`GET /assets/{id}/download`（成片需已通過審核） |
| 審核 | `GET /reviews/queue`、`POST /jobs/{id}/review` |
| 成本 | `GET /usage/summary`（按人、按日、按模型）、`GET /jobs/{id}/calls` |
| 審計（admin） | `GET /audit-logs` |
| 配置（admin） | `GET /config/models`（不含密鑰）、`GET/PATCH /config/budget` |

長任務一律丟 Celery；API 請求內不等待生成結果。

## 6. 前端頁面（React，繁體中文）

1. 登入頁
2. 任務列表（我的／全部，按狀態篩選）
3. 新建任務精靈：選模板 → 填主題、上傳或選素材 → 設畫幅、時長、音頻方式 → 提交
4. 分鏡確認頁：逐條編輯旁白與畫面描述、替換首幀、成本預估、確認生成
5. 任務詳情：分鏡進度（SSE）、單鏡頭預覽與重做、成片預覽
6. 批量建立（上傳 CSV）
7. 成片庫：搜尋、篩選、下載（審核通過才可下載）
8. 素材庫
9. 審核台
10. 用量與成本看板
11. 管理：模板、用戶、預算與模型配置、審計日誌

## 7. 成本控制

- **預估**：`Σ 分鏡時長 × 模型每秒 token 估算 × 單價` + 關鍵幀張數 × 單價 + 大模型與 TTS 估算；在分鏡確認頁顯示。
- **預算**：`budget.per_job_cny`（預設 50）、`budget.per_user_daily_cny`（預設 300）；用到 80% 時提示，超限時狀態記 `budget_exceeded` 並停止後續步驟。人少（10 人內），先不做部門級預算。
- **樣片模式**：模型支援 `draft` 時優先用官方樣片，否則用 `video_draft` 模型或低解析度；用戶確認後再出正片。
- **賬本**：每次調用寫 `cost_ledger`（實際 usage × 單價）；預估與實際同時保存。
- 分鏡確認前不調 Seedance；單分鏡失敗只重做該分鏡。

## 8. 非功能需求

| 項目 | 要求 |
|---|---|
| 密鑰管理 | 只從環境變量讀（`ARK_API_KEY`、`TTS_APP_ID`、`TTS_TOKEN`、`S3_*`）；不進代碼、日誌、前端、測試數據；日誌過濾 Authorization 與帶簽名 URL |
| 限流 | 按模型令牌桶（`rpm`、`concurrency`，讀 models.yaml）；批量限制同時運行數 |
| 失敗重試 | 只重試限流、超時、服務端錯誤；指數退避；內容審核錯誤直接回報並標註 |
| 輪詢 | Seedance 10 秒起、上限 60 秒指數退避，總超時可配置；成功後立即轉存 `video_url` 與 `last_frame_url` |
| 日誌 | structlog JSON，每請求帶 `request_id`，Celery 任務帶 `job_id`、`scene_id` |
| AI 生成標識 | 片頭 2 秒「本影片由 AI 生成」+ 畫面角落常駐小字；元數據寫內容編號、生成方式、平台名稱；不提供去標識功能 |
| 合規 | 模板禁用真人名、明星、第三方品牌、影視 IP；真人肖像只用授權素材；傳 `safety_identifier`（內部用戶 ID） |
| 安全 | 外部 URL 下載前檢查域名白名單與大小（防 SSRF）；上傳校驗類型與大小；密碼用 argon2 |
| 權限 | 角色權限在 API 層強制；創作者只看自己的任務，審核者與管理員看全部 |
| 輸出 | H.264 + AAC MP4，響度標準化（-14 LUFS），附封面圖 |
| 部署 | 公司 Linux 服務器 Docker Compose；不需要 GPU |

## 9. 後續階段與交付物

| 階段 | 內容 | 交付物 |
|---|---|---|
| P3 | 項目骨架 | backend（FastAPI、SQLAlchemy、Alembic、Celery ping）、frontend（登入、空列表）、compose、CI、ADR 0001 |
| P4 | 模型網關 | providers：ArkBase、LLM、Seedream、Seedance、TTS 接口、Mock；cost_ledger；live 冒煙測試（不執行） |
| P5 | 腳本與分鏡 | 三類模板、SceneList 校驗與修復、成本預估、內容檢查 |
| P6 | 素材庫與關鍵幀 | 上傳、縮圖、Seedream 關鍵幀、預簽名 URL |
| P7 | 分鏡影片生成 | 並行／連續鏡頭、樣片模式、單鏡頭重做、SSE |
| P8 | 配音、字幕、背景音樂 | TTS、SRT、BGM 壓低、時長對齊 |
| P9 | FFmpeg 合成 | 拼接、轉場、字幕、Logo、AI 標識、響度、封面 |
| P10 | 編排與批量 | 完整狀態機、續跑、預算、CSV 批量 |
| P11 | 前端與 E2E | 全部頁面、Playwright 走通行銷短影音 |
| P12 | 權限、審核、審計 | 角色、審核清單、審計日誌 |
| P13 | 測試與部署 | 覆蓋率、安全掃描、compose.prod.yaml、runbook |

## 10. 驗收清單

- [ ] 輸入主題產出 15～30 秒豎屏行銷短影音；單鏡頭失敗可單獨重做
- [ ] 上傳 20 張商品圖，批量產出 20 條圖生短片
- [ ] 產出 2 分鐘橫屏培訓講解片，配音與字幕對齊
- [ ] 每個任務顯示預估與實際成本，超預算自動停止（`budget_exceeded`）
- [ ] 所有成片帶片頭 AI 提示、角落標識與元數據標識（ffprobe 可驗）
- [ ] 審核通過才可下載，審計日誌可查
- [ ] 密鑰不在代碼倉、日誌與對話中；單元測試不調真實 API
- [ ] 公司服務器 `docker compose up -d` 一鍵部署，runbook 照做即可

## 11. 風險與待確認問題

1. **雲端環境**：本會話連不到 BytePlus／方舟，也拉不到 Docker 映像（見 docs/env-check.md）。P3 的 compose 冒煙驗收只能在 CI 或修好白名單後的 `video-factory-dev` 環境完成——是否接受？
2. **國際版 TTS**：手冊的豆包語音是國內版服務；BytePlus 的 TTS 產品與域名待確認。P8 前需要你提供可用的 TTS 服務（或第一版國際版只用模型原生音頻 `generate_audio`）。
3. **幣種**：BytePlus 以美元計價。建議賬本存原幣 + 換算 CNY（匯率放配置），預算仍以 CNY 設定——是否同意？
4. **對象存儲**：生產需公網可訪問的 S3 兼容存儲讓 Seedance 拉素材；國際版不用 TOS，請確認用哪家（例如 BytePlus TOS、AWS S3、Cloudflare R2）。
5. **Node 與 ffmpeg**：本環境 Node 22、無系統 ffmpeg；骨架仍按 Node 24 撰寫（`engines`），CI 與 Docker 映像負責正確版本。
6. **登入**：第一版本地帳號，管理員用 CLI 建立首個帳號——是否足夠？
