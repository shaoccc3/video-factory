import type { CostEstimate, JobDetail, JobSummary, Scene, Template, User } from "../api/types";

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "u-1",
    email: "admin@example.com",
    display_name: "測試管理員",
    roles: ["admin", "creator", "reviewer"],
    is_active: true,
    daily_budget_cny: null,
    created_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

export function makeTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: "tpl-marketing",
    key: "marketing",
    name: "行銷短影音",
    description: "9:16 商品短片",
    video_type: "marketing",
    ratio: "9:16",
    resolution: "720p",
    min_duration_s: 15,
    max_duration_s: 30,
    min_shots: 3,
    max_shots: 6,
    audio_mode: "tts",
    subtitle_required: true,
    style_prefix: "",
    prompt_template: "",
    is_active: true,
    version: 1,
    ...overrides,
  };
}

export function makeScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: "s-0",
    index: 0,
    narration: "清晨的茶園",
    visual_prompt: "晨霧中的茶園，陽光灑落",
    shot_type: "遠景",
    camera_move: "推鏡",
    duration_s: 5,
    needs_first_frame: false,
    screen_text: "",
    first_frame_asset_id: null,
    status: "pending",
    attempt: 0,
    video_asset_id: null,
    last_frame_asset_id: null,
    audio_asset_id: null,
    error_kind: null,
    error_message: null,
    is_draft: false,
    ...overrides,
  };
}

export function makeEstimate(overrides: Partial<CostEstimate> = {}): CostEstimate {
  return {
    total_cny: 12.5,
    items: [
      { label: "影片生成", model_key: "video", quantity: 15, unit: "s", amount_cny: 12 },
      { label: "腳本", model_key: "llm", quantity: 1, unit: "次", amount_cny: 0.5 },
    ],
    budget_per_job_cny: 50,
    spent_today_cny: 10,
    daily_budget_cny: 300,
    within_budget: true,
    near_limit: false,
    ...overrides,
  };
}

export function makeJobSummary(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    id: "job-1",
    title: "綠茶推廣",
    status: "draft",
    video_type: "marketing",
    template_id: "tpl-marketing",
    template_name: "行銷短影音",
    owner_id: "u-1",
    owner_name: "測試管理員",
    ratio: "9:16",
    draft_mode: false,
    batch_id: null,
    estimated_cost_cny: null,
    actual_cost_cny: 0,
    final_asset_id: null,
    cover_asset_id: null,
    progress: { total: 0, succeeded: 0, failed: 0 },
    created_at: "2026-09-23T00:00:00Z",
    updated_at: "2026-09-23T00:00:00Z",
    ...overrides,
  };
}

export function makeJob(overrides: Partial<JobDetail> = {}): JobDetail {
  return {
    ...makeJobSummary(),
    inputs: { topic: "清晨的茶園，推廣自家綠茶", extra: "" },
    options: {
      target_duration_s: null,
      audio_mode: "tts",
      continuous_shots: false,
      product_asset_ids: [],
      logo_asset_id: null,
      bgm_asset_id: null,
      image_asset_id: null,
    },
    seed: 42,
    scenes: [],
    warnings: [],
    estimate: null,
    error_kind: null,
    error_code: null,
    error_message: null,
    subtitle_asset_id: null,
    reviews: [],
    allowed_actions: [],
    ...overrides,
  };
}
