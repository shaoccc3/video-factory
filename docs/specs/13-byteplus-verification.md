# 13 BytePlus 官方文件核對：模型 ID、參數與價格

狀態：已確認（2026-09-23，決定見文末）　日期：2026-09-23

## 背景

規格 12 的決定 1：`video-factory-dev` 環境允許 `docs.byteplus.com` 後，直接讀官方文件核對 `config/models.yaml` 的「待核對」值。
現在已能讀取。本規格記錄核對結果，並列出要改的配置與代碼。

資料來源（2026-09-23 讀取，括號內為文件最後更新時間，UTC）：

| 文件 | 連結 |
|---|---|
| Model list（2026-09-22） | https://docs.byteplus.com/en/docs/modelark/1330310 |
| Pricing（2026-09-22） | https://docs.byteplus.com/en/docs/modelark/1544106 |
| Create a video generation task（2026-09-22） | https://docs.byteplus.com/en/docs/ModelArk/1520757 |
| Retrieve a video generation task（2026-09-09） | https://docs.byteplus.com/en/docs/ModelArk/1521309 |
| Dreamina Seedance 2.5 tutorial（2026-09-23） | https://docs.byteplus.com/en/docs/ModelArk/2607688 |
| Image generation API（2026-09-22） | https://docs.byteplus.com/en/docs/ModelArk/1541523 |
| Chat API（2026-09-18）、Deep reasoning（2026-09-18） | https://docs.byteplus.com/en/docs/ModelArk/1494384 、…/1449737 |
| Seedance 限時折扣規則（2026-09-21） | https://docs.byteplus.com/en/docs/ModelArk/2630943 |

## 核對結果

### 1. 模型 ID

| 鍵 | 現值 | 官方 | 結論 |
|---|---|---|---|
| `script_llm` | 佔位 | 文字模型：`seed-2-0-lite-260428`、`seed-2-0-mini-260428`、`seed-2-0-pro-260328`、`dola-seed-2-1-turbo-260628` 等 | 建議 `seed-2-0-lite-260428`（見待確認 1） |
| `keyframe` | 佔位 | `seedream-5-0-260128`，同時接受 `seedream-5-0-lite-260128`（價格表用後者） | 用 `seedream-5-0-lite-260128` |
| `video_draft` | `dreamina-seedance-2-0-fast-260128` | 同左 | 正確 |
| `video_final` | `dreamina-seedance-2-0-260128` | 同左 | 正確 |
| `video_long` | 佔位 | `dreamina-seedance-2-5-260628` | 填入 |
| `tts` | 佔位 | BytePlus 文件沒有豆包語音 | 維持待核對（只用於國內版） |

另有 `dreamina-seedance-2-0-mini-260615`（480p／720p，牌價 3.5 USD／百萬 token），可作樣片的更便宜選項；本規格不換（規格 12 已定樣片用 2.0 fast）。

### 2. 價格（BytePlus，USD）

| 鍵 | 現值 | 官方牌價 | 結論 |
|---|---|---|---|
| `script_llm` | 0.8／百萬 token（輸入輸出合計） | lite-260428，提示 ≤128K：輸入 0.25、輸出 2.00（輸出含思維鏈）；提示 128K～256K：0.50／4.00 | 輸入與輸出分開計價 |
| `keyframe` | 0.035／張 | 5.0 lite：輸出 0.035／張，輸入圖免費 | 正確 |
| （註解）Seedream Pro | 約 0.075 | `dola-seedream-5-0-pro-260628`：≤2.61MP 0.045、更大 0.09；另有 `dola-seedream-5-0-flash-260915` 0.018 | 更正註解 |
| `video_draft` | 1.5 | 480p／720p：無影片輸入 5.6、有影片輸入 3.3 | 改為 5.6 |
| `video_final` | 3.5 | 480p／720p：7.0（有影片輸入 4.3）；1080p：7.7（4.7）；4K：4.0（2.4） | 改為按解析度分價 |
| `video_long` | 3.5 | 480p／720p：10.70（有影片輸入 6.40）；1080p：11.7（7.0） | 改為按解析度分價 |

- **有聲與無聲同價**：Seedance 2.0／2.5 的單價只隨輸出解析度、輸入是否含影片變化，與 `generate_audio` 無關（按有聲／無聲分價的只有已退役的 1.5 pro）。`price_per_mtok_audio` 不填。
- **token 用量**：官方公式 `(輸入影片時長 + 輸出影片時長) × 寬 × 高 × 幀率 / 1024`，實際以查詢任務返回的 `usage.completion_tokens` 為準（輸入含影片時有最低用量）。我們目前不送參考影片，輸入影片時長為 0。
- **寬高**：官方有逐一列出的像素表，和我們按「短邊 = 解析度」推算的值不同。16:9、9:16 基本一致；1:1、4:3、3:4 我們低估（720p 1:1 官方 960×960，我們算 720×720，少估 44%）；21:9 我們高估。
- **限時折扣**：2.0 fast 25% off（5.6 → 4.20）、2.0 mini 60% off，只限企業用戶，到 2026-10-07 14:00（UTC+8）或用量到上限為止。預估按牌價（見待確認 3）。

以現行模板試算（匯率 7.1，牌價；舊值為目前配置算出的結果）：

| 情境 | 新預估 | 舊預估 |
|---|---|---|
| 行銷：2.5 正片 720p 9:16 共 30 秒 | 49.2 CNY | 16.1 CNY |
| 行銷：2.0 fast 樣片 480p 9:16 共 30 秒 | 12.0 CNY | 3.1 CNY |
| 行銷：2.5 正片 1080p 9:16 共 30 秒 | 121.1 CNY | 36.2 CNY |
| 快速：2.0 正片 720p 9:16 15 秒 | 16.1 CNY | 8.1 CNY |
| 培訓：2.0 正片 720p 16:9 180 秒 | 193.2 CNY | 96.6 CNY |

目前單任務預算 50 CNY、每人每日 300 CNY：行銷片（樣片約 12 + 正片約 49）已超過單任務預算，培訓長片遠超（見待確認 2）。

### 3. 請求參數

**Seedance（`POST /contents/generations/tasks`）**

| 參數 | 我們現在 | 官方 | 處理 |
|---|---|---|---|
| `content[].type` | `text`、`image_url`、`audio_url` | 同左，另有 `video_url`、`draft_task` | 正確 |
| `content[].role` | `first_frame`、`reference_image`、`reference_audio` | `first_frame`、`last_frame`、`reference_image`、`reference_video`、`reference_audio` | 正確 |
| 參考素材上限 | 2.0：9／3／3；2.5：30／10／10 | 同左（圖／影片／音頻） | 正確 |
| 參考音頻長度 | 取第一鏡前 10 秒 mp3 | wav、mp3；每段 2～15 秒（2.5 為 2～30），≤15 MB | 正確 |
| `generate_audio` | 一律顯式傳 | 名稱正確，**預設 true**；2.5、2.0 系列支援 | 正確（必須繼續顯式傳 false） |
| `duration` | 4～15／4～30 | 2.0 系列 [4, 15] 或 -1；2.5 [4, 30] 或 -1 | 正確 |
| `resolution` | 2.0：480p／720p／1080p；fast：480p／720p | 同左，2.0 另有 4k | 正確（不用 4K） |
| `ratio` | 固定傳任務畫幅 | 另有 `adaptive`；**2.5 首幀／首尾幀圖生影片只接受 `adaptive`**，否則非同步報錯 `InvalidParameter.TaskTypeConstraint` | 2.5 帶首幀時改傳 `adaptive` |
| `seed` | 一律傳 | **只有 1.x 系列支援**；請求體參數是嚴格校驗 | 2.x 不傳 |
| `camera_fixed` | 目前沒有地方設定 | 只有 1.x 支援 | 不變 |
| `draft` | 2.0 不傳 | 只有 2.5、1.5 pro 支援；2.5 草稿只能 480p，由草稿生成正片只能 1080p | 2.0 維持 false；2.5 也設 false（樣片走 `video_draft`，不用兩步流程） |
| 首幀與參考素材混用 | 第一鏡以後，首幀 + 參考音頻會一起送 | **首幀、首尾幀、全能參考（參考圖／影片／音頻）互斥，不能混用** | 見設計 4 與待確認 4 |
| 只送參考音頻 | 沒有圖時可能只送音頻 | 2.0 系列不支援只有音頻，至少要有一張參考圖或一段參考影片；2.5 可以 | 2.0 沒有圖時不送參考音頻 |
| `return_last_frame` | true | 名稱正確；返回 **jpeg** | 正確 |
| `watermark` | 按設定 | 名稱正確，預設 false | 正確 |
| `safety_identifier` | 用戶 UUID | 名稱正確，≤64 字元 | 正確 |
| 任務狀態 | queued／running／succeeded／failed／cancelled | 另有 **`expired`** | 現在會被當成 running 一直輪詢到總超時；改為失敗（超時類） |
| 1080p 輸出編碼 | — | 2.5 的 1080p 為 10-bit H.265 | 合成時重新編碼為 H.264，不需改；列為風險 |

**Seedream（`POST /images/generations`）**

| 參數 | 我們現在 | 官方 | 處理 |
|---|---|---|---|
| `size` | 用影片寬高，例如 `720x1280` | 5.0 lite 總像素須在 [2560×1440, 4096×4096]，寬高比 [1/16, 16] | **現值會被拒絕**；改用官方 2K 對照表（如 9:16 → `1600x2848`），配置在 models.yaml |
| `seed` | 一律傳 | 5.0 系列文件沒有此參數 | 不傳 |
| `output_format` | 未傳（預設 jpeg），但存成 `.png`、MIME `image/png` | 5.0 lite 支援 `png`／`jpeg` | 傳 `png` |
| `image`、`watermark`、`response_format` | — | 名稱正確；5.0 lite 最多 14 張參考圖 | 正確 |
| `safety_identifier` | 不傳 | 文件沒有此參數 | 正確 |

**Chat（`POST /chat/completions`）**

| 參數 | 我們現在 | 官方 | 處理 |
|---|---|---|---|
| `response_format` | `{"type": "json_object"}` | `text`、`json_object`、`json_schema`（beta）；lite-260428 建議 `json_schema` | 不變（改 `json_schema` 另立規格） |
| `user` | 傳用戶 UUID（當作 safety_identifier） | Chat API 與 Responses API 都**沒有** `user` 或 `safety_identifier` 參數 | 見待確認 5 |
| `thinking`、`reasoning_effort` | 未傳 | seed 2.0 系列預設開啟深度思考、`reasoning_effort` 預設 `medium`；思維鏈按輸出 token 計費 | 不變（計費已按 completion_tokens） |
| `max_tokens` | 未傳 | 預設 4096，不含思維鏈 | 不變；列為風險 |

### 4. 限速（官方上限）

| 模型 | 官方 | 我們的配置 |
|---|---|---|
| Seedance 2.0／2.0 fast／2.5 | 企業 600 RPM、並發 10；個人 180 RPM、並發 3 | rpm 10、concurrency 2（在上限內，不改） |
| Seedream 5.0 lite | 500 IPM | rpm 30（不改） |
| seed-2-0-lite-260428 | 30K RPM、1500K TPM | rpm 60（不改） |

## 目標

1. `config/models.yaml` 的 BytePlus 值全部換成官方值，去掉「待核對」（TTS 除外），註解寫明來源與日期。
2. 計價結構能表達官方價格：大模型輸入／輸出分價、影片按解析度分價、影片 token 用官方寬高表。
3. 真實調用的請求參數符合官方文件，避免同步 400 或非同步 `TaskTypeConstraint` 錯誤。

## 不做的事

- 輸入含參考影片的計價：目前流程不送參考影片；單價只寫在 models.yaml 註解。
- 4K、2.5 的兩步 Draft 流程、`output_format: mov`、`priority`、`callback_url`、`omni_reference_task_type`。
- 限時折扣的自動切換（按牌價預估，實際扣費以賬單為準）。
- 豆包語音 TTS 價格（國內版，CNY，不在 BytePlus 文件）。
- 合成輸出尺寸：`composing.py` 仍用現有 `video_dimensions`，不在本規格改。
- 大模型改用 `json_schema` 結構化輸出。
- 真實 API 驗證（需要 `/live-smoke`）。

## 設計

### 1. config/models.yaml（節錄）

```yaml
models:
  script_llm:
    id: "seed-2-0-lite-260428"
    price_per_mtok_input: 0.25    # 提示 ≤128K 檔；(128K, 256K] 為 0.50／4.00
    price_per_mtok_output: 2.00   # 含思維鏈 token
    rpm: 60                       # 官方上限 30K RPM、1500K TPM
    concurrency: 4
  keyframe:
    id: "seedream-5-0-lite-260128"   # 等同 seedream-5-0-260128
    price_per_image: 0.035
    image_sizes:                     # 5.0 lite 最小總像素 2560x1440；官方 2K 對照表
      "16:9": "2848x1600"
      "9:16": "1600x2848"
      "1:1": "2048x2048"
      "4:3": "2304x1728"
      "3:4": "1728x2304"
      "21:9": "3136x1344"
  video_draft:
    id: "dreamina-seedance-2-0-fast-260128"
    price_per_mtok: 5.6              # 480p／720p，無影片輸入；有影片輸入 3.3
    capabilities:
      supports_seed: false
      dimensions: *seedance_2_0_dims # 官方寬高表（480p／720p／1080p × 6 種畫幅）
      reference_audio_needs_visual: true
      ...
  video_final:
    id: "dreamina-seedance-2-0-260128"
    price_per_mtok: 7.0              # 480p／720p；有影片輸入 4.3
    price_per_mtok_by_resolution: {"1080p": 7.7}   # 有影片輸入 4.7；4K 4.0／2.4（不用）
  video_long:
    id: "dreamina-seedance-2-5-260628"
    price_per_mtok: 10.70            # 480p／720p；有影片輸入 6.40
    price_per_mtok_by_resolution: {"1080p": 11.7}  # 有影片輸入 7.0
    capabilities:
      frames_require_adaptive_ratio: true
      reference_audio_needs_visual: false
      dimensions: *seedance_2_5_dims # 與 2.0 只差 480p 的 16:9、9:16
```

寬高表用 YAML 錨點共用，2.0 與 2.0 fast 共用一份。

### 2. 配置結構（`app/core/models_config.py`）

`ModelEntry` 新增（皆選填）：
- `price_per_mtok_input`、`price_per_mtok_output`：大模型分價；未填時退回 `price_per_mtok` 按總 token 計。
- `price_per_mtok_by_resolution: dict[str, float]`：影片按解析度覆蓋 `price_per_mtok`；鍵必須在 `capabilities.resolutions` 內。
- `image_sizes: dict[str, str]`：關鍵幀按畫幅指定尺寸（`寬x高`）。

`VideoCapabilities` 新增：
- `supports_seed: bool = False`
- `frames_require_adaptive_ratio: bool = False`：帶首幀／尾幀時 `ratio` 只能傳 `adaptive`（2.5）。
- `reference_audio_needs_visual: bool = False`：參考音頻必須搭配參考圖或參考影片（2.0 系列）。
- `dimensions: dict[str, dict[str, str]] | None`：官方寬高表；有填時必須涵蓋 `resolutions × ratios` 每一格，沒填時退回現有推算。

配置錯誤時沿用 `ModelsConfigError`，錯誤訊息指出欄位。

### 3. 計價（`pricing.py`、`gateway.py`、`estimate.py`）

- `video_unit_price(cfg, key, resolution, audio)`：`price_per_mtok_by_resolution[resolution]` → `price_per_mtok_audio`（有聲且有填時）→ `price_per_mtok`。
- `video_tokens_for(caps, resolution, ratio, duration_s)`：有 `dimensions` 就查表，否則用 `video_dimensions`。預估（分鏡確認頁）、預算檢查、Mock 的 `completion_tokens` 都改用它。
- `llm_cost(cfg, prompt_tokens, completion_tokens, region)`：輸入、輸出各自乘單價。預算預檢沿用現在的估法（輸入按字數、輸出按 2000）。
- `cost_ledger.unit_price` 仍是單一數值：影片記實際採用的解析度單價；大模型記加權平均單價（金額 ÷ 總 token），輸入與輸出單價寫進 `usage`。不需要遷移。

### 4. 請求參數（`base.py`、`generation.py`、`live.py`）

- `VideoRequest.seed` 改為 `int | None`，`None` 時不送；`build_video_request` 只在 `caps.supports_seed` 時帶 `job.seed`。
- `VideoRequest` 新增 `adaptive_ratio: bool`，為 true 時 payload 送 `"ratio": "adaptive"`；`ratio` 欄位仍保留任務畫幅，用於預估與 Mock。帶首幀且 `caps.frames_require_adaptive_ratio` 時設為 true。首幀是按任務畫幅生成的，2.5 會沿用它的畫幅。
- 首幀與參考音頻互斥（待確認 4 採建議做法時）：要送參考音頻時，首幀改以 `reference_image` 送出，提示詞開頭加「以參考圖片 1 作為影片第一幀。」；不送參考音頻時行為不變。
- `caps.reference_audio_needs_visual` 為 true 且沒有任何參考圖時，不送參考音頻（記一條 warning 日誌）。
- `parse_task`：`expired` 狀態映射為 `failed`，`error_code` 設為 `TaskExpired`（`classify_code` 已把 expired 歸為超時）。
- `ArkSeedream`：不送 `seed`；送 `"output_format": "png"`。`ensure_keyframe` 的尺寸改用 `keyframe.image_sizes[ratio]`，沒配置時退回現在的影片寬高。
- `ArkLLM` 的 `user` 欄位按待確認 5 處理。

### 5. 管理頁與 API 契約

- `GET /config/models` 回應的模型項目新增選填欄位 `price_per_mtok_input`、`price_per_mtok_output`、`price_per_mtok_by_resolution`（後端已按非空欄位輸出，不用改後端）。API 契約升為 v1.2。
- 前端管理頁「模型」表：單價欄改為文字摘要，例如大模型「入 0.25／出 2.00」、影片「7.0（1080p 7.7）」；文案放 i18n。

### 6. 錯誤處理

- 2.5 帶首幀時送固定畫幅、2.0 只送參考音頻、Seedream 尺寸過小：本規格實作後不會再送出；萬一平台返回 `InvalidParameter*`，照現有分類歸為 client 錯誤，不重試。
- `expired`：歸為超時類錯誤，照現有規則可重試。

## 任務清單

- [ ] 配置結構：`ModelEntry`、`VideoCapabilities` 新欄位與校驗，含單元測試
- [ ] `config/models.yaml`：官方 ID、價格、寬高表、關鍵幀尺寸、限速註解；刪除已核對項的「待核對」；預算示例值 150／600
- [ ] 計價：`video_unit_price`、`video_tokens_for`、`llm_cost`；網關記賬、預算預檢、分鏡頁預估、Mock 用量改用新函數
- [ ] Seedance 請求：`seed` 按能力表、2.5 首幀送 `adaptive`、首幀與參考音頻互斥、2.0 參考音頻需要參考圖、`expired` 狀態
- [ ] Seedream 請求：不送 `seed`、送 `output_format: png`、尺寸用 `image_sizes`
- [ ] 大模型：不送 `user`；`.claude/rules/project.md` 的 safety_identifier 規則改為「接口支援時」
- [ ] 管理頁單價摘要、i18n、`types.ts`；API 契約 v1.2
- [ ] 文件：規格 12 待確認 1 標為已完成、`docs/CHANGELOG.md`；CLAUDE.md 命令不變

## 驗收清單

- [ ] `cd backend && uv run pytest tests/test_models_config.py`：倉庫配置通過校驗；`models.yaml` 只剩 `tts` 帶「待核對」（`grep -c 待核對 config/models.yaml` 只命中 tts 那幾行與檔頭說明）
- [ ] `uv run pytest -k pricing`：
  - 2.5、720p、9:16、30 秒預估 = 648,000 token × 10.70 USD／百萬 × 7.1 ≈ 49.2 CNY
  - 2.0、1080p 單價取 7.7；720p 取 7.0
  - 720p 1:1 按 960×960 計 token
  - 大模型 10,000 輸入 + 3,000 輸出 = 0.0085 USD
- [ ] `uv run pytest -k video_request`：
  - 2.0／2.5 的 payload 沒有 `seed`
  - 2.5 帶首幀時 `ratio == "adaptive"`；2.0 帶首幀時 `ratio` 為任務畫幅
  - 開啟聲音一致的第 2 鏡：content 裡沒有 `first_frame`，有 `reference_image` 與 `reference_audio`，提示詞帶首幀說明
  - 2.0 沒有任何圖時不送 `reference_audio`
- [ ] `uv run pytest -k seedream`：payload 沒有 `seed`、有 `output_format: png`；9:16 任務的 `size == "1600x2848"`
- [ ] `uv run pytest -k parse_task`：`status: expired` 解析為 failed，錯誤類型為超時
- [ ] CLAUDE.md 的後端、前端檢查全部通過
- [ ] `scripts/dev-local.sh start && (cd frontend && pnpm e2e)`：通過，管理頁模型表截圖顯示新單價摘要
- [ ] 真實驗證（需要 `/live-smoke` 與 API Key，不在本次執行）：2.5 帶首幀、2.0 帶參考圖 + 參考音頻各一條 4 秒 480p，確認不報參數錯誤

## 風險與待確認問題

### 待確認

1. **腳本大模型**：建議 `seed-2-0-lite-260428`（輸入 0.25、輸出 2.00；官方建議搭配 `json_schema`）。
   更便宜：`seed-2-0-mini-260428`（0.10／0.40）；更強：`dola-seed-2-1-turbo-260628`（0.5／2.5）。用 lite 可以嗎？
2. **預算**：官方價比現在配置高 2～4 倍。行銷片一條（樣片約 12 + 正片約 49 CNY）已超過單任務預算 50 CNY，
   培訓片 180 秒正片約 193 CNY。建議把 `budget` 示例值改為單任務 150 CNY、每人每日 600 CNY（管理頁仍可覆蓋），或者你給數字。
3. **折扣**：2.0 fast 企業用戶 75 折到 2026-10-07。建議預估按牌價（保守，不會少估）。同意嗎？
4. **聲音一致與首幀衝突**：官方規定首幀與參考素材互斥，現在的「聲音一致」在帶首幀的鏡頭上真實調用會失敗。建議：開啟聲音一致時，首幀改以參考圖送出，在提示詞裡指定它是第一幀（畫面接近，但不保證第一幀完全一致）。
   另一個做法是保留首幀、放棄參考音頻（只靠 `voice_style` 描述維持聲音）。選哪個？
5. **大模型的用戶標識**：Chat API 與 Responses API 都沒有 `user`／`safety_identifier` 參數，現在送的 `user` 可能被忽略，也可能被拒。
   建議：不送，用戶仍記在 `generation_calls.user_id`（Seedream 已是這樣）；同時把項目規則「調用時把平台內部用戶 ID 傳給 safety_identifier」改為「接口支援時」。同意嗎？

### 風險

- 價格與 ID 取自 2026-09-22／23 的文件，平台會更新；models.yaml 註解寫明核對日期。
- `seed` 在 2.5 教程的 Draft 參數表裡出現，但 API 參考只列 1.x 支援；按 API 參考不送。代價是 2.x 無法用 seed 重現結果。
- 2.5 的 1080p 輸出是 10-bit H.265；合成會重新編碼為 H.264，需要 ffmpeg 能解 HEVC 10-bit（常見版本都支援），真實驗證時確認。
- Seedance 2.x 不接受含真人臉的參考圖／影片。關鍵幀由 Seedream 生成，平台說可信任部分模型的原始輸出，但未列明是否包含 Seedream；真實驗證時確認。
- 大模型 `max_tokens` 預設 4096（不含思維鏈）；培訓片 12 個分鏡的 JSON 可能接近上限而被截斷，觸發修復重試。先觀察，必要時另開規格加配置。
- 豆包語音 TTS 的價格仍待核對，需要讀火山引擎文件或控制台。

## 決定（2026-09-23）

1. 腳本大模型用 `seed-2-0-lite-260428`。
2. 預算示例值改為單任務 150 CNY、每人每日 600 CNY（管理頁仍可覆蓋）。
3. 預估按牌價，不套限時折扣。
4. 聲音一致與首幀衝突：要送參考音頻時，首幀改以 `reference_image` 送出，提示詞指定它是第一幀。
5. 大模型不再送 `user`；項目規則改為「接口支援時把平台內部用戶 ID 傳給 safety_identifier」。
