"""成本預估：按分鏡數、時長、模型單價計算，顯示在分鏡確認頁與開新片頁。"""

import math
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models_config import ModelKey, ModelsConfig, Region, VideoModelKey
from app.models import Job, Scene, User
from app.models.enums import AudioMode, JobPhase, SceneStatus
from app.pipeline.common import clip_duration, job_options, job_resolution, storyboard_rules, video_model_key
from app.providers.pricing import (
    CHARS_PER_SECOND,
    cost_per_image,
    cost_per_kchar,
    video_cost,
    video_tokens_for,
)
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
    audio: bool = False,
) -> CostItem:
    caps = config.video_caps(key)
    seconds = sum(clip_duration(s.duration_s, caps) for s in scenes)
    tokens = video_tokens_for(caps, resolution, ratio, seconds)
    amount = video_cost(
        config, key, tokens, region, resolution=resolution, audio=audio and caps.supports_audio
    )[1]
    return CostItem(label, key, seconds, "秒", round(amount, 4))


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
    key = video_model_key(job, config)
    audio = job_options(job).audio_mode == AudioMode.NATIVE
    label = "分鏡樣片（Seedance）" if job.phase == JobPhase.DRAFT else "分鏡影片（Seedance）"
    if audio:
        label = label.replace("）", "，含聲音）")
    items.append(
        _video_item(config, key, region, pending, job_resolution(job, config), job.ratio, label, audio)
    )
    if job.phase == JobPhase.DRAFT:
        final_key: VideoModelKey = (
            "video_long"
            if job.template_snapshot.get("video_model") == "video_long" and config.models.has("video_long")
            else "video_final"
        )
        final_caps = config.video_caps(final_key)
        final_res = job.resolution if job.resolution in final_caps.resolutions else final_caps.resolutions[-1]
        items.append(
            _video_item(config, final_key, region, scenes, final_res, job.ratio, "正片（樣片確認後）", audio)
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


async def _summarize(
    session: AsyncSession,
    config: ModelsConfig,
    job: Job | None,
    owner: User,
    items: list[CostItem],
    used: float,
) -> CostEstimate:
    """加總並對照預算。job 為 None 時單任務上限取目前的預算設定；used 為任務已花的金額。"""
    total = round(sum(i.amount_cny for i in items), 4)
    limits = await limits_for(session, config, job, owner)
    today = await spent_today(session, owner.id)
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


async def estimate_job(
    session: AsyncSession, config: ModelsConfig, job: Job, scenes: list[Scene], owner: User
) -> CostEstimate:
    items = estimate_items(config, job, scenes)
    return await _summarize(session, config, job, owner, items, await spent_on_job(session, job.id))


def synthetic_scenes(config: ModelsConfig, job: Job) -> list[Scene]:
    """還沒寫分鏡時的假設分鏡（規格 14：開新片的即時預估）。

    - 鏡頭數：模板鏡頭數上下限取中間值、向上取整。
    - 時長：目標時長（未填時取模板範圍中間值）平均分到各鏡，再按模型能力表取整與夾緊（同 clip_duration）。
    - 保守估算：每鏡都要生成首幀；TTS 旁白按念滿鏡頭時長（時長 × 每秒字數）計字數。
    只建立不加入會話的物件，不寫數據庫。
    """
    rules = storyboard_rules(job, config)
    shots = max(1, math.ceil((rules.min_shots + rules.max_shots) / 2))
    duration = float(clip_duration(rules.target_total_s / shots, rules.caps))
    narration = "字" * int(duration * CHARS_PER_SECOND)
    return [
        Scene(
            index=index,
            duration_s=duration,
            narration=narration,
            needs_first_frame=True,
            first_frame_asset_id=None,
            audio_asset_id=None,
            status=SceneStatus.PENDING.value,
            is_draft=False,
        )
        for index in range(shots)
    ]


async def estimate_preview(
    session: AsyncSession, config: ModelsConfig, job: Job, owner: User
) -> CostEstimate:
    """開新片的預估：job 為尚未建立（不加入會話）的任務，用 synthetic_scenes 的假設分鏡計算。

    單任務上限取目前的預算設定；任務還沒有花費，只加上今日已用判斷每日上限。
    """
    items = estimate_items(config, job, synthetic_scenes(config, job))
    return await _summarize(session, config, None, owner, items, 0.0)
