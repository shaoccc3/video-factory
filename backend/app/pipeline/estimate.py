"""成本預估：按分鏡數、時長、模型單價計算，顯示在分鏡確認頁。"""

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models_config import ModelKey, ModelsConfig, Region, video_dimensions
from app.models import Job, Scene, User
from app.models.enums import AudioMode, JobPhase
from app.pipeline.common import clip_duration, job_options, job_resolution, video_model_key
from app.providers.pricing import cost_per_image, cost_per_kchar, cost_per_mtok, video_tokens
from app.services.budget import NEAR_LIMIT_RATIO, limits_for, spent_on_job, spent_today


@dataclass(frozen=True)
class CostItem:
    label: str
    model_key: str
    quantity: float
    unit: str
    amount_cny: float


@dataclass(frozen=True)
class CostEstimate:
    total_cny: float
    items: list[CostItem]
    budget_per_job_cny: float
    spent_today_cny: float
    daily_budget_cny: float
    within_budget: bool
    near_limit: bool


def _video_item(
    config: ModelsConfig,
    key: ModelKey,
    region: Region,
    scenes: list[Scene],
    resolution: str,
    ratio: str,
    label: str,
) -> CostItem:
    caps = config.video_caps(key)
    width, height = video_dimensions(resolution, ratio)
    seconds = sum(clip_duration(s.duration_s, caps) for s in scenes)
    tokens = video_tokens(width, height, caps.fps, seconds)
    return CostItem(label, key, seconds, "秒", round(cost_per_mtok(config, key, tokens, region)[1], 4))


def estimate_items(config: ModelsConfig, job: Job, scenes: list[Scene]) -> list[CostItem]:
    """剩餘步驟的預估（已成功的分鏡不再計算）。"""
    region: Region = job.region  # type: ignore[assignment]
    pending = [s for s in scenes if s.status != "succeeded" or s.is_draft != (job.phase == JobPhase.DRAFT)]
    items: list[CostItem] = []
    keyframes = sum(1 for s in pending if s.needs_first_frame and s.first_frame_asset_id is None)
    if keyframes:
        items.append(
            CostItem(
                "關鍵幀（Seedream）",
                "keyframe",
                keyframes,
                "張",
                round(cost_per_image(config, keyframes, region)[1], 4),
            )
        )
    key = video_model_key(job)
    label = "分鏡樣片（Seedance）" if job.phase == JobPhase.DRAFT else "分鏡影片（Seedance）"
    items.append(_video_item(config, key, region, pending, job_resolution(job, config), job.ratio, label))
    if job.phase == JobPhase.DRAFT:
        final_res = (
            job.resolution if job.resolution in config.video_caps("video_final").resolutions else "720p"
        )
        items.append(
            _video_item(config, "video_final", region, scenes, final_res, job.ratio, "正片（樣片確認後）")
        )
    if job_options(job).audio_mode == AudioMode.TTS:
        chars = sum(len(s.narration.replace(" ", "")) for s in scenes if not s.audio_asset_id)
        if chars:
            items.append(
                CostItem(
                    "配音（TTS）", "tts", chars, "字", round(cost_per_kchar(config, chars, region)[1], 4)
                )
            )
    return items


async def estimate_job(
    session: AsyncSession, config: ModelsConfig, job: Job, scenes: list[Scene], owner: User
) -> CostEstimate:
    items = estimate_items(config, job, scenes)
    total = round(sum(i.amount_cny for i in items), 4)
    limits = await limits_for(session, config, job, owner)
    today = await spent_today(session, owner.id)
    used = await spent_on_job(session, job.id)
    # 樣片模式下正片是確認後才花的錢，不擋第一步
    now_cost = total - sum(i.amount_cny for i in items if i.label.startswith("正片"))
    within = used + now_cost <= limits.job_budget_cny and today + now_cost <= limits.daily_budget_cny
    near = (
        used + total >= NEAR_LIMIT_RATIO * limits.job_budget_cny
        or today + total >= NEAR_LIMIT_RATIO * limits.daily_budget_cny
    )
    return CostEstimate(
        total_cny=total,
        items=items,
        budget_per_job_cny=limits.job_budget_cny,
        spent_today_cny=round(today, 4),
        daily_budget_cny=limits.daily_budget_cny,
        within_budget=within,
        near_limit=near,
    )
