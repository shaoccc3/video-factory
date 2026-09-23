"""API 請求與回應結構，與 docs/specs/api-contract.md 一致。"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.enums import (
    AssetKind,
    AudioMode,
    ErrorKind,
    JobStatus,
    ReviewDecision,
    Role,
    SceneStatus,
    VideoType,
)

Ratio = Literal["9:16", "16:9", "1:1", "4:3", "3:4", "21:9"]
VideoModel = Literal["video_final", "video_long"]


class _Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- 用戶 ---------------------------------------------------------------------


class UserOut(_Out):
    id: uuid.UUID
    email: str
    display_name: str
    roles: list[Role]
    is_active: bool
    daily_budget_cny: float | None
    created_at: datetime


class LoginIn(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(max_length=200)


class UserCreate(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8, max_length=200)
    roles: list[Role] = Field(min_length=1)
    daily_budget_cny: float | None = Field(default=None, ge=0)


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    password: str | None = Field(default=None, min_length=8, max_length=200)
    roles: list[Role] | None = Field(default=None, min_length=1)
    is_active: bool | None = None
    daily_budget_cny: float | None = Field(default=None, ge=0)


# ---- 模板 ---------------------------------------------------------------------


class TemplateBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = ""
    video_type: VideoType
    ratio: Ratio
    resolution: Literal["480p", "720p", "1080p"]
    min_duration_s: int = Field(gt=0, le=600)
    max_duration_s: int = Field(gt=0, le=600)
    min_shots: int = Field(gt=0, le=40)
    max_shots: int = Field(gt=0, le=40)
    audio_mode: AudioMode
    subtitle_required: bool
    style_prefix: str = Field(default="", max_length=500)
    prompt_template: str = Field(min_length=1, max_length=8000)
    is_active: bool = True
    video_model: VideoModel = "video_final"


class TemplateOut(TemplateBase, _Out):
    id: uuid.UUID
    key: str
    version: int


class TemplateCreate(TemplateBase):
    key: str = Field(pattern=r"^[a-z0-9_-]{2,64}$")


class TemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = None
    video_type: VideoType | None = None
    ratio: Ratio | None = None
    resolution: Literal["480p", "720p", "1080p"] | None = None
    min_duration_s: int | None = Field(default=None, gt=0, le=600)
    max_duration_s: int | None = Field(default=None, gt=0, le=600)
    min_shots: int | None = Field(default=None, gt=0, le=40)
    max_shots: int | None = Field(default=None, gt=0, le=40)
    audio_mode: AudioMode | None = None
    video_model: VideoModel | None = None
    subtitle_required: bool | None = None
    style_prefix: str | None = Field(default=None, max_length=500)
    prompt_template: str | None = Field(default=None, min_length=1, max_length=8000)
    is_active: bool | None = None


# ---- 素材 ---------------------------------------------------------------------


class AssetOut(BaseModel):
    id: uuid.UUID
    kind: AssetKind
    mime: str
    size: int
    width: int | None
    height: int | None
    duration_s: float | None
    tags: list[str]
    display_name: str
    source: Literal["upload", "generated"]
    created_at: datetime
    content_url: str
    thumbnail_url: str | None


class Page[T](BaseModel):
    items: list[T]
    total: int


# ---- 任務 ---------------------------------------------------------------------


class Progress(BaseModel):
    total: int
    succeeded: int
    failed: int


class JobSummary(BaseModel):
    id: uuid.UUID
    title: str
    status: JobStatus
    video_type: VideoType
    template_id: uuid.UUID
    template_name: str
    owner_id: uuid.UUID
    owner_name: str
    ratio: str
    draft_mode: bool
    batch_id: uuid.UUID | None
    estimated_cost_cny: float | None
    actual_cost_cny: float
    final_asset_id: uuid.UUID | None
    cover_asset_id: uuid.UUID | None
    # v1.3：列表與卡片的畫面。依序取封面、最後一個成功鏡頭的尾幀、第一個有首幀的鏡頭的首幀
    preview_asset_id: uuid.UUID | None
    progress: Progress
    created_at: datetime
    updated_at: datetime


class SceneOut(_Out):
    id: uuid.UUID
    index: int
    narration: str
    visual_prompt: str
    shot_type: str
    camera_move: str
    duration_s: float
    needs_first_frame: bool
    screen_text: str
    speaker: str
    sound: str
    first_frame_asset_id: uuid.UUID | None
    status: SceneStatus
    attempt: int
    video_asset_id: uuid.UUID | None
    last_frame_asset_id: uuid.UUID | None
    audio_asset_id: uuid.UUID | None
    error_kind: ErrorKind | None
    error_message: str | None
    is_draft: bool


class CostItemOut(BaseModel):
    label: str
    model_key: str
    quantity: float
    unit: str
    amount_cny: float


class CostEstimateOut(BaseModel):
    total_cny: float
    items: list[CostItemOut]
    budget_per_job_cny: float
    spent_today_cny: float
    daily_budget_cny: float
    within_budget: bool
    near_limit: bool


class EstimatePreviewIn(BaseModel):
    """v1.3：開新片的即時預估。欄位與校驗同 JobCreate；resolution 省略時用模板預設。"""

    template_id: uuid.UUID
    target_duration_s: float | None = Field(default=None, gt=0, le=600)
    ratio: Ratio | None = None
    audio_mode: AudioMode | None = None
    draft_mode: bool = False
    resolution: Literal["480p", "720p", "1080p"] | None = None


class EstimatePreviewOut(BaseModel):
    total_cny: float
    items: list[CostItemOut]
    budget_per_job_cny: float
    within_budget: bool


class ReviewOut(BaseModel):
    id: uuid.UUID
    reviewer_id: uuid.UUID
    reviewer_name: str
    decision: ReviewDecision
    checklist: dict[str, bool]
    reason: str
    created_at: datetime


class JobInputs(BaseModel):
    topic: str = Field(max_length=500)
    extra: str = Field(default="", max_length=2000)


class JobOptionsOut(BaseModel):
    target_duration_s: float | None
    audio_mode: AudioMode
    continuous_shots: bool
    product_asset_ids: list[uuid.UUID]
    logo_asset_id: uuid.UUID | None
    bgm_asset_id: uuid.UUID | None
    image_asset_id: uuid.UUID | None
    voice_style: str
    music: str
    consistent_voice: bool


class ShotDurationOut(BaseModel):
    """v1.3：單鏡時長範圍（秒），來自目前階段影片模型的能力；生成時超出會被夾回這個範圍。"""

    min_s: int
    max_s: int


class JobDetail(JobSummary):
    inputs: JobInputs
    options: JobOptionsOut
    seed: int
    scenes: list[SceneOut]
    warnings: list[str]
    estimate: CostEstimateOut | None
    error_kind: ErrorKind | None
    error_code: str | None
    error_message: str | None
    subtitle_asset_id: uuid.UUID | None
    reviews: list[ReviewOut]
    allowed_actions: list[str]
    shot_duration_s: ShotDurationOut


class JobCreate(BaseModel):
    template_id: uuid.UUID
    title: str = Field(default="", max_length=200)
    inputs: JobInputs
    target_duration_s: float | None = Field(default=None, gt=0, le=600)
    audio_mode: AudioMode | None = None
    ratio: Ratio | None = None
    draft_mode: bool = False
    continuous_shots: bool = False
    product_asset_ids: list[uuid.UUID] = Field(default_factory=list, max_length=10)
    logo_asset_id: uuid.UUID | None = None
    bgm_asset_id: uuid.UUID | None = None
    image_asset_id: uuid.UUID | None = None
    voice_style: str = Field(default="", max_length=100)
    music: str = Field(default="", max_length=100)
    consistent_voice: bool = False


class SceneUpdate(BaseModel):
    narration: str | None = Field(default=None, max_length=400)
    visual_prompt: str | None = Field(default=None, min_length=1, max_length=800)
    shot_type: str | None = Field(default=None, max_length=50)
    camera_move: str | None = Field(default=None, max_length=50)
    duration_s: float | None = Field(default=None, gt=0, le=60)
    needs_first_frame: bool | None = None
    screen_text: str | None = Field(default=None, max_length=60)
    speaker: str | None = Field(default=None, max_length=50)
    sound: str | None = Field(default=None, max_length=200)
    first_frame_asset_id: uuid.UUID | None = None


class RegenerateIn(BaseModel):
    target: Literal["keyframe", "video"]


class KeyframePreviewIn(BaseModel):
    """v1.3：首幀預覽。鏡頭已有首幀時要帶 force=true 才會重新生成。"""

    force: bool = False


class ReviewIn(BaseModel):
    decision: ReviewDecision
    checklist: dict[str, bool]
    reason: str = Field(default="", max_length=1000)


class GenerationCallOut(BaseModel):
    id: uuid.UUID
    scene_id: uuid.UUID | None
    provider: Literal["llm", "seedream", "seedance", "tts"]
    model_id: str
    remote_task_id: str | None
    status: str
    error_kind: ErrorKind | None
    error_code: str | None
    attempt: int
    started_at: datetime
    finished_at: datetime | None
    duration_ms: int | None
    cost_cny: float


# ---- 批量 ---------------------------------------------------------------------


class BatchOut(BaseModel):
    id: uuid.UUID
    template_id: uuid.UUID
    template_name: str
    total: int
    max_parallel: int
    status: Literal["running", "done"]
    created_at: datetime
    counts: dict[str, int]


class BatchDetail(BatchOut):
    jobs: list[JobSummary]


# ---- 用量與配置 ---------------------------------------------------------------


class UsageByUser(BaseModel):
    user_id: uuid.UUID
    display_name: str
    amount_cny: float


class UsageByDay(BaseModel):
    date: str
    amount_cny: float


class UsageByModel(BaseModel):
    model_id: str
    calls: int
    amount_cny: float


class UsageSummary(BaseModel):
    total_cny: float
    today_user_cny: float
    daily_budget_cny: float
    by_user: list[UsageByUser]
    by_day: list[UsageByDay]
    by_model: list[UsageByModel]


class BudgetOut(BaseModel):
    per_job_cny: float
    per_user_daily_cny: float


class BudgetUpdate(BaseModel):
    per_job_cny: float | None = Field(default=None, gt=0)
    per_user_daily_cny: float | None = Field(default=None, gt=0)


class MetaOut(BaseModel):
    region: str
    tts_available: bool
    chars_per_second: float
    audio_modes: list[AudioMode]


class ModelsConfigOut(BaseModel):
    region: str
    provider_mode: str
    currency: str
    models: dict[str, dict[str, object]]
    budget: BudgetOut


class AuditLogOut(BaseModel):
    id: uuid.UUID
    actor_id: uuid.UUID | None
    actor_name: str | None
    action: str
    target_type: str | None
    target_id: str | None
    detail: dict[str, object]
    ip: str | None
    created_at: datetime
