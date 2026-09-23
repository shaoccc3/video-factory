// 與 docs/specs/api-contract.md（v1.1）一一對應；欄位名保持 snake_case。

export const ROLES = ["admin", "creator", "reviewer"] as const;
export type Role = (typeof ROLES)[number];

export const VIDEO_TYPES = ["marketing", "quick", "training"] as const;
export type VideoType = (typeof VIDEO_TYPES)[number];

export const AUDIO_MODES = ["tts", "native", "none"] as const;
export type AudioMode = (typeof AUDIO_MODES)[number];

/** 正片用的影片模型（v1.1）：video_long = Seedance 2.5，單鏡最長 30 秒 */
export const VIDEO_MODELS = ["video_final", "video_long"] as const;
export type VideoModel = (typeof VIDEO_MODELS)[number];

export type Region = "byteplus" | "volcengine";

export const RATIOS = ["9:16", "16:9", "1:1", "4:3", "3:4", "21:9"] as const;
export type Ratio = (typeof RATIOS)[number];

export const JOB_STATUSES = [
  "draft",
  "scripting",
  "storyboard_ready",
  "generating",
  "composing",
  "in_review",
  "approved",
  "rejected",
  "failed",
  "cancelled",
  "budget_exceeded",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const SCENE_STATUSES = [
  "pending",
  "keyframe",
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type SceneStatus = (typeof SCENE_STATUSES)[number];

export const ASSET_KINDS = [
  "logo",
  "product",
  "image",
  "font",
  "bgm",
  "keyframe",
  "clip",
  "last_frame",
  "voice",
  "subtitle",
  "final",
  "cover",
  "csv",
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** 上傳允許的 kind */
export const UPLOAD_KINDS = ["logo", "product", "image", "bgm", "font"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

export const ERROR_KINDS = [
  "moderation",
  "rate_limit",
  "timeout",
  "server",
  "client",
  "budget",
  "internal",
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

export type ReviewDecision = "approved" | "rejected";

export const JOB_ACTIONS = [
  "submit",
  "edit_storyboard",
  "regenerate_script",
  "confirm_storyboard",
  "preview_keyframe",
  "regenerate_scene",
  "render_final",
  "cancel",
  "resume",
  "review",
  "download",
] as const;
export type JobAction = (typeof JOB_ACTIONS)[number];

export const CHECKLIST_KEYS = [
  "ai_label",
  "no_real_person",
  "no_third_party_ip",
  "brand_guideline",
  "subtitle_ok",
] as const;
export type ChecklistKey = (typeof CHECKLIST_KEYS)[number];

export interface User {
  id: string;
  email: string;
  display_name: string;
  roles: Role[];
  is_active: boolean;
  daily_budget_cny: number | null;
  created_at: string;
}

export interface Template {
  id: string;
  key: string;
  name: string;
  description: string;
  video_type: VideoType;
  ratio: Ratio;
  resolution: string;
  min_duration_s: number;
  max_duration_s: number;
  min_shots: number;
  max_shots: number;
  audio_mode: AudioMode;
  subtitle_required: boolean;
  style_prefix: string;
  prompt_template: string;
  is_active: boolean;
  version: number;
  /** v1.1 */
  video_model: VideoModel;
}

export type TemplateCreate = Omit<Template, "id" | "version">;
export type TemplateUpdate = Partial<TemplateCreate>;

export interface Asset {
  id: string;
  kind: AssetKind;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  tags: string[];
  display_name: string;
  source: "upload" | "generated";
  created_at: string;
  content_url: string;
  thumbnail_url: string | null;
}

export interface Scene {
  id: string;
  index: number;
  narration: string;
  visual_prompt: string;
  shot_type: string;
  camera_move: string;
  duration_s: number;
  needs_first_frame: boolean;
  screen_text: string;
  /** v1.1：說話者（「旁白」或角色泛稱） */
  speaker: string;
  /** v1.1：音效／環境音描述 */
  sound: string;
  first_frame_asset_id: string | null;
  status: SceneStatus;
  attempt: number;
  video_asset_id: string | null;
  last_frame_asset_id: string | null;
  audio_asset_id: string | null;
  error_kind: ErrorKind | null;
  error_message: string | null;
  is_draft: boolean;
}

export interface SceneUpdate {
  narration?: string;
  visual_prompt?: string;
  shot_type?: string;
  camera_move?: string;
  duration_s?: number;
  needs_first_frame?: boolean;
  screen_text?: string;
  speaker?: string;
  sound?: string;
  first_frame_asset_id?: string | null;
}

export interface CostItem {
  label: string;
  model_key: string;
  quantity: number;
  unit: string;
  amount_cny: number;
}

export interface CostEstimate {
  total_cny: number;
  items: CostItem[];
  budget_per_job_cny: number;
  spent_today_cny: number;
  daily_budget_cny: number;
  within_budget: boolean;
  near_limit: boolean;
}

/** POST /jobs/estimate（v1.3）：開新片的即時預估 */
export interface EstimatePreviewRequest {
  template_id: string;
  target_duration_s?: number | null;
  ratio?: Ratio | null;
  audio_mode?: AudioMode | null;
  draft_mode?: boolean;
  resolution?: "480p" | "720p" | "1080p" | null;
}

export interface EstimatePreview {
  total_cny: number;
  items: CostItem[];
  budget_per_job_cny: number;
  within_budget: boolean;
}

export interface JobProgress {
  total: number;
  succeeded: number;
  failed: number;
}

export interface JobSummary {
  id: string;
  title: string;
  status: JobStatus;
  video_type: VideoType;
  template_id: string;
  template_name: string;
  owner_id: string;
  owner_name: string;
  ratio: Ratio;
  draft_mode: boolean;
  batch_id: string | null;
  estimated_cost_cny: number | null;
  actual_cost_cny: number;
  final_asset_id: string | null;
  cover_asset_id: string | null;
  /** v1.3：封面，否則最後一個成功鏡頭的尾幀，否則第一個有首幀的鏡頭的首幀 */
  preview_asset_id: string | null;
  progress: JobProgress;
  created_at: string;
  updated_at: string;
}

export interface Review {
  id: string;
  reviewer_id: string;
  reviewer_name: string;
  decision: ReviewDecision;
  checklist: Record<string, boolean>;
  reason: string;
  created_at: string;
}

export interface JobOptions {
  target_duration_s: number | null;
  audio_mode: AudioMode;
  continuous_shots: boolean;
  product_asset_ids: string[];
  logo_asset_id: string | null;
  bgm_asset_id: string | null;
  image_asset_id: string | null;
  /** v1.1 */
  voice_style: string;
  music: string;
  consistent_voice: boolean;
}

export interface JobDetail extends JobSummary {
  inputs: { topic: string; extra: string };
  options: JobOptions;
  seed: number;
  scenes: Scene[];
  warnings: string[];
  estimate: CostEstimate | null;
  error_kind: ErrorKind | null;
  error_code: string | null;
  error_message: string | null;
  subtitle_asset_id: string | null;
  reviews: Review[];
  /** 後端決定的可用動作；前端只看這個決定按鈕，不自行推導狀態機 */
  allowed_actions: string[];
}

export interface GenerationCall {
  id: string;
  scene_id: string | null;
  provider: "llm" | "seedream" | "seedance" | "tts";
  model_id: string;
  remote_task_id: string | null;
  status: string;
  error_kind: ErrorKind | null;
  error_code: string | null;
  attempt: number;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  cost_cny: number;
}

export interface Batch {
  id: string;
  template_id: string;
  template_name: string;
  total: number;
  max_parallel: number;
  status: "running" | "done";
  created_at: string;
  counts: Partial<Record<JobStatus, number>>;
}

export interface BatchDetail extends Batch {
  jobs: JobSummary[];
}

export interface JobCreate {
  template_id: string;
  title: string;
  inputs: { topic: string; extra?: string };
  target_duration_s?: number | null;
  audio_mode?: AudioMode | null;
  ratio?: Ratio | null;
  draft_mode?: boolean;
  continuous_shots?: boolean;
  product_asset_ids?: string[];
  logo_asset_id?: string | null;
  bgm_asset_id?: string | null;
  /** quick 類型：圖生影片的首幀 */
  image_asset_id?: string | null;
  /** v1.1：聲音風格，≤ 100 字 */
  voice_style?: string;
  /** v1.1：配樂描述，≤ 100 字；"none" 表示不要配樂 */
  music?: string;
  /** v1.1：用第一鏡的聲音作後續鏡頭的參考音頻（較慢） */
  consistent_voice?: boolean;
}

/** GET /meta（v1.1） */
export interface PlatformMeta {
  region: Region;
  tts_available: boolean;
  /** 每秒建議旁白字數；每鏡上限 = floor(時長 × chars_per_second) */
  chars_per_second: number;
  audio_modes: AudioMode[];
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface JobListParams {
  /** v1.3：可帶多個狀態 */
  status?: JobStatus | JobStatus[] | undefined;
  /** v1.3：created（預設）或 updated */
  sort?: "created" | "updated" | undefined;
  video_type?: VideoType | undefined;
  mine?: boolean | undefined;
  q?: string | undefined;
  batch_id?: string | undefined;
  page?: number | undefined;
  page_size?: number | undefined;
}

export interface AssetListParams {
  kind?: AssetKind | undefined;
  tag?: string | undefined;
  q?: string | undefined;
  page?: number | undefined;
  page_size?: number | undefined;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface UserCreate {
  email: string;
  display_name: string;
  password: string;
  roles: Role[];
  daily_budget_cny?: number | null;
}

export interface UserUpdate {
  display_name?: string;
  password?: string;
  roles?: Role[];
  is_active?: boolean;
  daily_budget_cny?: number | null;
}

export interface ReviewRequest {
  decision: ReviewDecision;
  checklist: Record<ChecklistKey, boolean>;
  reason: string;
}

export interface UsageSummary {
  total_cny: number;
  today_user_cny: number;
  daily_budget_cny: number;
  by_user: { user_id: string; display_name: string; amount_cny: number }[];
  by_day: { date: string; amount_cny: number }[];
  by_model: { model_id: string; calls: number; amount_cny: number }[];
}

export interface ModelConfig {
  id: string;
  price_per_mtok?: number;
  /** 大模型輸入／輸出分價（每百萬 token） */
  price_per_mtok_input?: number;
  price_per_mtok_output?: number;
  /** 影片按輸出解析度覆蓋 price_per_mtok */
  price_per_mtok_by_resolution?: Record<string, number>;
  price_per_image?: number;
  rpm?: number;
  concurrency?: number;
}

export interface BudgetConfig {
  per_job_cny: number;
  per_user_daily_cny: number;
}

export interface ModelsConfig {
  region: string;
  provider_mode: string;
  currency: string;
  models: Record<string, ModelConfig>;
  budget: BudgetConfig;
}

export interface BudgetUpdate {
  per_job_cny?: number;
  per_user_daily_cny?: number;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: unknown;
  ip: string | null;
  created_at: string;
}

export interface AuditLogParams {
  action?: string | undefined;
  page?: number | undefined;
  page_size?: number | undefined;
}

export interface BatchCsvCreate {
  template_id: string;
  file: File;
  max_parallel: number;
  draft_mode: boolean;
}

export interface BatchImagesCreate {
  template_id: string;
  files: File[];
  topic: string;
  max_parallel: number;
  draft_mode: boolean;
}

export interface AssetUpload {
  file: File;
  kind: UploadKind;
  tags: string[];
}

export type SceneRegenerateTarget = "keyframe" | "video";
