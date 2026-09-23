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

JobSummary = {
  id: string; title: string; status: JobStatus; video_type: VideoType;
  template_id: string; template_name: string;
  owner_id: string; owner_name: string;
  ratio: Ratio; draft_mode: boolean; batch_id: string | null;
  estimated_cost_cny: number | null; actual_cost_cny: number;
  final_asset_id: string | null; cover_asset_id: string | null;
  progress: { total: number; succeeded: number; failed: number };  // 分鏡數
  created_at: string; updated_at: string;
}

JobDetail = JobSummary & {
  inputs: { topic: string; extra: string };
  options: {
    target_duration_s: number | null; audio_mode: AudioMode; continuous_shots: boolean;
    product_asset_ids: string[]; logo_asset_id: string | null; bgm_asset_id: string | null;
    image_asset_id: string | null;
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
| GET | `/jobs?status=&video_type=&mine=&q=&batch_id=&page=&page_size=` | — | `{ items: JobSummary[], total }`；creator 只看到自己的 |
| GET | `/jobs/{id}` | — | `JobDetail` |
| POST | `/jobs/{id}/submit` | — | `JobDetail`（→ `scripting`，完成後自動 → `storyboard_ready`） |
| POST | `/jobs/{id}/regenerate-script` | — | `JobDetail` |
| PATCH | `/jobs/{id}/scenes/{scene_id}` | `{ narration?, visual_prompt?, shot_type?, camera_move?, duration_s?, needs_first_frame?, screen_text?, first_frame_asset_id? }` | `JobDetail` |
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
  inputs: { topic: string; extra?: string };
  target_duration_s?: number | null; audio_mode?: AudioMode | null; ratio?: Ratio | null;
  draft_mode?: boolean; continuous_shots?: boolean;
  product_asset_ids?: string[]; logo_asset_id?: string | null;
  bgm_asset_id?: string | null; image_asset_id?: string | null;  // quick 類型：圖生影片的首幀
}
```

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

### 用量與配置
| 方法 | 路徑 | 回應 |
|---|---|---|
| GET | `/usage/summary?days=30` | `{ total_cny, today_user_cny, daily_budget_cny, by_user: [{ user_id, display_name, amount_cny }], by_day: [{ date, amount_cny }], by_model: [{ model_id, calls, amount_cny }] }`（creator 只看自己） |
| GET | `/config/models`（admin） | `{ region, provider_mode, currency, models: Record<string, { id, price_per_mtok?, price_per_image?, rpm?, concurrency? }>, budget: { per_job_cny, per_user_daily_cny } }` |
| PATCH | `/config/budget`（admin） | `{ per_job_cny?, per_user_daily_cny? }` → 同上 `budget` |
| GET | `/audit-logs?action=&page=&page_size=`（admin） | `{ items: [{ id, actor_id, actor_name, action, target_type, target_id, detail, ip, created_at }], total }` |
