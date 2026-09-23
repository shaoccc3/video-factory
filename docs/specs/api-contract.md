# API 契約（v1）

前後端共用的接口定義。後端以此實作（FastAPI + Pydantic），前端以此寫型別與請求。欄位名一律 snake_case；時間為 ISO 8601（UTC）；金額單位 CNY（number）；ID 為 UUID 字串。

- 基礎路徑：`/api/v1`（健康檢查 `/healthz`、`/readyz` 在根路徑）
- 認證：`POST /api/v1/auth/login` 成功後設置 HttpOnly Cookie `vf_session`（SameSite=Lax）。之後的請求帶 Cookie 即可（前端 `fetch(..., { credentials: "include" })`）。未登入回 401，無權限回 403。
- 錯誤格式：`{ "detail": string }`（422 時 FastAPI 預設格式 `{ "detail": [{ "loc": [...], "msg": "..." }] }`）
- 分頁：`?page=1&page_size=20`，回傳 `{ "items": [...], "total": number }`

## 列舉

| 名稱 | 值 |
|---|---|
| Role | `admin`、`creator`、`reviewer` |
| VideoType | `marketing`、`quick`、`training` |
| AudioMode | `tts`（TTS 旁白）、`native`（模型原生音頻）、`none` |
| Ratio | `9:16`、`16:9`、`1:1`、`4:3`、`3:4`、`21:9` |
| JobStatus | `draft`、`scripting`、`storyboard_ready`、`generating`、`composing`、`in_review`、`approved`、`rejected`、`failed`、`cancelled`、`budget_exceeded` |
| SceneStatus | `pending`、`keyframe`、`queued`、`running`、`succeeded`、`failed`、`cancelled` |
| AssetKind | `logo`、`product`、`image`、`font`、`bgm`、`keyframe`、`clip`、`last_frame`、`voice`、`subtitle`、`final`、`cover`、`csv` |
| ErrorKind | `moderation`、`rate_limit`、`timeout`、`server`、`client`、`budget`、`internal` |
| ReviewDecision | `approved`、`rejected` |

上傳允許的 kind：`logo`、`product`、`image`、`bgm`、`font`。

## 物件

```ts
User = {
  id: string; email: string; display_name: string; roles: Role[];
  is_active: boolean; daily_budget_cny: number | null; created_at: string;
}

Template = {
  id: string; key: string; name: string; description: string; video_type: VideoType;
  ratio: Ratio; resolution: string;            // 例如 "720p"
  min_duration_s: number; max_duration_s: number;
  min_shots: number; max_shots: number;
  audio_mode: AudioMode; subtitle_required: boolean;
  style_prefix: string; prompt_template: string; is_active: boolean; version: number;
  video_model: "video_final" | "video_long";   // v1.1：正片用的影片模型（video_long = Seedance 2.5，單鏡最長 30 秒）
}

Asset = {
  id: string; kind: AssetKind; mime: string; size: number;
  width: number | null; height: number | null; duration_s: number | null;
  tags: string[]; display_name: string; source: "upload" | "generated";
  created_at: string;
  content_url: string;          // 例如 "/api/v1/assets/{id}/content"（可直接放進 <img>/<video>）
  thumbnail_url: string | null; // 圖片與影片有縮圖
}

Scene = {
  id: string; index: number;                  // 從 0 開始
  narration: string; visual_prompt: string;
  shot_type: string; camera_move: string; duration_s: number;
  needs_first_frame: boolean; screen_text: string;
  speaker: string;                            // v1.1：說話者（「旁白」或角色泛稱）
  sound: string;                              // v1.1：音效／環境音描述
  first_frame_asset_id: string | null;
  status: SceneStatus; attempt: number;
  video_asset_id: string | null; last_frame_asset_id: string | null; audio_asset_id: string | null;
  error_kind: ErrorKind | null; error_message: string | null;
  is_draft: boolean;                          // 目前片段是樣片
}

CostItem = { label: string; model_key: string; quantity: number; unit: string; amount_cny: number }
CostEstimate = {
  total_cny: number; items: CostItem[];
  budget_per_job_cny: number; spent_today_cny: number; daily_budget_cny: number;
  within_budget: boolean; near_limit: boolean;   // near_limit：已用 + 預估 ≥ 80% 上限
}
EstimatePreview = {                           // v1.3：開新片的即時預估（POST /jobs/estimate）
  total_cny: number; items: CostItem[];
  budget_per_job_cny: number;                 // 目前的單任務上限
  within_budget: boolean;                     // 預估（樣片模式不含正片）不超過單任務上限，且加上今日已用不超過每日上限
}

JobSummary = {
  id: string; title: string; status: JobStatus; video_type: VideoType;
  template_id: string; template_name: string;
  owner_id: string; owner_name: string;
  ratio: Ratio; draft_mode: boolean; batch_id: string | null;
  estimated_cost_cny: number | null; actual_cost_cny: number;
  final_asset_id: string | null; cover_asset_id: string | null;
  preview_asset_id: string | null;            // v1.3：卡片畫面，依序取封面、最後一個成功鏡頭的尾幀、第一個有首幀的鏡頭的首幀；都沒有時為 null
  progress: { total: number; succeeded: number; failed: number };  // 分鏡數
  created_at: string; updated_at: string;
}

JobDetail = JobSummary & {
  inputs: { topic: string; extra: string };
  options: {
    target_duration_s: number | null; audio_mode: AudioMode; continuous_shots: boolean;
    product_asset_ids: string[]; logo_asset_id: string | null; bgm_asset_id: string | null;
    image_asset_id: string | null;
    voice_style: string; music: string; consistent_voice: boolean;   // v1.1
  };
  seed: number;
  scenes: Scene[];
  warnings: string[];                         // 內容檢查警告（真人名、品牌、IP）
  estimate: CostEstimate | null;
  error_kind: ErrorKind | null; error_code: string | null; error_message: string | null;
  subtitle_asset_id: string | null;
  reviews: Review[];                          // 由新到舊
  allowed_actions: string[];                  // 見下方「動作」
}

Review = {
  id: string; reviewer_id: string; reviewer_name: string; decision: ReviewDecision;
  checklist: Record<string, boolean>; reason: string; created_at: string;
}

GenerationCall = {
  id: string; scene_id: string | null; provider: "llm" | "seedream" | "seedance" | "tts";
  model_id: string; remote_task_id: string | null; status: string;
  error_kind: ErrorKind | null; error_code: string | null; attempt: number;
  started_at: string; finished_at: string | null; duration_ms: number | null;
  cost_cny: number;
}

Batch = {
  id: string; template_id: string; template_name: string; total: number; max_parallel: number;
  status: "running" | "done"; created_at: string;
  counts: Partial<Record<JobStatus, number>>;
}
```

`allowed_actions` 可能的值：`submit`、`edit_storyboard`、`regenerate_script`、`confirm_storyboard`、`regenerate_scene`、`render_final`、`cancel`、`resume`、`review`、`download`。前端按這個決定按鈕是否顯示，不要自己推導狀態機。

審核清單的鍵（`checklist`）：`ai_label`（AI 標識存在）、`no_real_person`（無未授權真人肖像）、`no_third_party_ip`（無第三方品牌或影視 IP）、`brand_guideline`（符合品牌規範）、`subtitle_ok`（字幕無錯字）。通過時五項都必須為 true。

## 接口

### 認證
| 方法 | 路徑 | 請求 | 回應 |
|---|---|---|---|
| POST | `/auth/login` | `{ email, password }` | `User`（並設 Cookie）；失敗 401 |
| POST | `/auth/logout` | — | 204 |
| GET | `/auth/me` | — | `User`；未登入 401 |

### 用戶（admin）
| 方法 | 路徑 | 請求 | 回應 |
|---|---|---|---|
| GET | `/users` | — | `User[]` |
| POST | `/users` | `{ email, display_name, password, roles, daily_budget_cny? }` | `User` |
| PATCH | `/users/{id}` | `{ display_name?, password?, roles?, is_active?, daily_budget_cny? }` | `User` |

### 模板
| 方法 | 路徑 | 請求 | 回應 |
|---|---|---|---|
| GET | `/templates?include_inactive=false` | — | `Template[]` |
| GET | `/templates/{id}` | — | `Template` |
| POST | `/templates`（admin） | Template 去掉 id、version | `Template` |
| PATCH | `/templates/{id}`（admin） | Template 任意欄位 | `Template`（version+1） |

### 任務
| 方法 | 路徑 | 請求 | 回應 |
|---|---|---|---|
| POST | `/jobs` | `JobCreate`（見下） | `JobDetail`（status=`draft`） |
| POST | `/jobs/estimate`（v1.3，creator、admin） | `EstimateCreate`（見下） | `EstimatePreview`；參數不合法 422（規則同 `POST /jobs`） |
| GET | `/jobs?status=&video_type=&mine=&q=&batch_id=&sort=&page=&page_size=` | — | `{ items: JobSummary[], total }`；creator 只看到自己的。v1.3：`status` 可重複帶多個值（`?status=generating&status=composing`），只帶一個時行為不變；`sort=created\|updated`（預設 `created`），按建立或更新時間由新到舊 |
| GET | `/jobs/{id}` | — | `JobDetail` |
| POST | `/jobs/{id}/submit` | — | `JobDetail`（→ `scripting`，完成後自動 → `storyboard_ready`） |
| POST | `/jobs/{id}/regenerate-script` | — | `JobDetail` |
| PATCH | `/jobs/{id}/scenes/{scene_id}` | `{ narration?, visual_prompt?, shot_type?, camera_move?, duration_s?, needs_first_frame?, screen_text?, speaker?, sound?, first_frame_asset_id? }` | `JobDetail` |
| GET | `/jobs/{id}/estimate` | — | `CostEstimate` |
| POST | `/jobs/{id}/confirm-storyboard` | — | `JobDetail`（→ `generating`）；超預算 409 |
| POST | `/jobs/{id}/scenes/{scene_id}/regenerate` | `{ target: "keyframe" \| "video" }` | `JobDetail` |
| POST | `/jobs/{id}/render-final` | — | `JobDetail`（樣片確認後出正片） |
| POST | `/jobs/{id}/cancel` | — | `JobDetail` |
| POST | `/jobs/{id}/resume` | — | `JobDetail` |
| GET | `/jobs/{id}/calls` | — | `GenerationCall[]` |
| GET | `/jobs/{id}/events` | — | SSE：`event: job`，`data: JobDetail`（狀態變化時推送；每 15 秒 `: ping`） |
| POST | `/jobs/{id}/review`（reviewer） | `{ decision, checklist, reason }` | `JobDetail`；退回時 reason 必填 |

```ts
JobCreate = {
  template_id: string; title: string;
  inputs: { topic: string; extra?: string };   // topic ≤ 500 字，extra ≤ 2000 字
  target_duration_s?: number | null; audio_mode?: AudioMode | null; ratio?: Ratio | null;
  draft_mode?: boolean; continuous_shots?: boolean;
  product_asset_ids?: string[]; logo_asset_id?: string | null;
  bgm_asset_id?: string | null; image_asset_id?: string | null;  // quick 類型：圖生影片的首幀
  voice_style?: string;       // v1.1：聲音風格，≤ 100 字，例如「溫暖、語速適中的年輕女聲，國語」
  music?: string;             // v1.1：配樂描述，≤ 100 字；"none" 表示不要配樂
  consistent_voice?: boolean; // v1.1：用第一鏡的聲音作後續鏡頭的參考音頻（較慢）
}

// v1.3：開新片的即時預估。畫幅、時長、聲音方式的預設與校驗同 JobCreate（例如國際版選 TTS 回 422）
EstimateCreate = {
  template_id: string; target_duration_s?: number | null; ratio?: Ratio | null;
  audio_mode?: AudioMode | null; draft_mode?: boolean;
  resolution?: "480p" | "720p" | "1080p" | null;  // 省略時用模板預設
}
```

`POST /jobs/estimate` 還沒有分鏡，按以下假設計算，再沿用 `GET /jobs/{id}/estimate` 的計價邏輯與 models.yaml 單價；不寫數據庫、不調用模型：
- 鏡頭數：模板 `min_shots`～`max_shots` 的中間值，向上取整。
- 時長：`target_duration_s`（省略時取模板時長範圍的中間值）平均分到各鏡，按模型能力表取整並夾緊到單鏡上下限。
- 保守估算：每鏡都生成首幀；TTS 旁白按念滿鏡頭時長計字數。
- 分鏡相同（鏡頭數、各鏡時長相同且都要生成首幀）的任務，`GET /jobs/{id}/estimate` 的 `items`、`total_cny` 與此相同；腳本（大模型）費用兩者都不計入。

### 審核
| 方法 | 路徑 | 回應 |
|---|---|---|
| GET | `/reviews/queue` | `JobSummary[]`（status=`in_review`） |

### 批量
| 方法 | 路徑 | 請求 | 回應 |
|---|---|---|---|
| POST | `/batches/csv` | multipart：`template_id`、`file`（CSV：`title,topic,extra`）、`max_parallel`（預設 2）、`draft_mode` | `Batch` |
| POST | `/batches/images` | multipart：`template_id`、`files`（多張圖）、`topic`（共用提示詞）、`max_parallel`、`draft_mode` | `Batch`（每張圖一個 quick 任務） |
| GET | `/batches` | — | `Batch[]` |
| GET | `/batches/{id}` | — | `Batch & { jobs: JobSummary[] }` |

批量建立的任務自動 submit；quick 類型不需人工確認分鏡，其餘類型停在 `storyboard_ready` 等確認。

### 素材
| 方法 | 路徑 | 請求 | 回應 |
|---|---|---|---|
| POST | `/assets` | multipart：`file`、`kind`、`tags`（逗號分隔） | `Asset`；類型或大小不符 422 |
| GET | `/assets?kind=&tag=&q=&page=&page_size=` | — | `{ items: Asset[], total }` |
| GET | `/assets/{id}` | — | `Asset` |
| DELETE | `/assets/{id}` | — | 204 |
| GET | `/assets/{id}/content` | 支援 `Range` | 文件內容（`final` 未通過審核時只有 reviewer、admin、擁有者可看） |
| GET | `/assets/{id}/thumbnail` | — | JPEG |
| GET | `/assets/{id}/download` | — | 附件下載；`final` 必須已通過審核，否則 403；寫審計日誌 |

### 平台資訊（v1.1）
| 方法 | 路徑 | 回應 |
|---|---|---|
| GET | `/meta` | `{ region: "byteplus" \| "volcengine", tts_available: boolean, chars_per_second: number, audio_modes: AudioMode[] }`（任何登入用戶）。`tts_available=false` 時前端不顯示 TTS 選項；`chars_per_second` 用來提示每鏡旁白字數上限（時長 × chars_per_second） |

聲音方式（AudioMode）說明（v1.1）：`native` 由影片模型直接生成旁白、對白、音效、配樂（行銷、quick 預設）；`tts` 影片無聲另配旁白（僅國內版，培訓片預設）；`none` 無聲。

### 用量與配置
| 方法 | 路徑 | 回應 |
|---|---|---|
| GET | `/usage/summary?days=30` | `{ total_cny, today_user_cny, daily_budget_cny, by_user: [{ user_id, display_name, amount_cny }], by_day: [{ date, amount_cny }], by_model: [{ model_id, calls, amount_cny }] }`（creator 只看自己） |
| GET | `/config/models`（admin） | `{ region, provider_mode, currency, models: Record<string, { id, price_per_mtok?, price_per_mtok_input?, price_per_mtok_output?, price_per_mtok_by_resolution?, price_per_image?, rpm?, concurrency? }>, budget: { per_job_cny, per_user_daily_cny } }`（v1.2：新增大模型輸入／輸出單價與影片按解析度單價，皆為選填；其他非空欄位照 models.yaml 輸出） |
| PATCH | `/config/budget`（admin） | `{ per_job_cny?, per_user_daily_cny? }` → 同上 `budget` |
| GET | `/audit-logs?action=&page=&page_size=`（admin） | `{ items: [{ id, actor_id, actor_name, action, target_type, target_id, detail, ip, created_at }], total }` |
