"""任務服務：建立任務、編輯分鏡、計算用戶可執行的動作。"""

import random
import uuid
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models_config import ModelsConfig
from app.models import Asset, Job, Scene, Template, User
from app.models.enums import AssetKind, AudioMode, JobPhase, JobStatus, Role, SceneStatus, VideoType
from app.pipeline.orchestrator import IN_FLIGHT, ActionError
from app.pipeline.templates import template_snapshot
from app.services.settings_store import get_budget


@dataclass
class JobInput:
    template_id: uuid.UUID
    title: str
    topic: str
    extra: str = ""
    target_duration_s: float | None = None
    audio_mode: AudioMode | None = None
    ratio: str | None = None
    draft_mode: bool = False
    continuous_shots: bool = False
    product_asset_ids: list[uuid.UUID] = field(default_factory=list)
    logo_asset_id: uuid.UUID | None = None
    bgm_asset_id: uuid.UUID | None = None
    image_asset_id: uuid.UUID | None = None
    batch_id: uuid.UUID | None = None


async def _check_asset(
    session: AsyncSession,
    asset_id: uuid.UUID | None,
    kinds: set[AssetKind],
    label: str,
    user: User,
) -> None:
    """上傳的素材全員共享；生成的素材（關鍵幀、尾幀等）只有擁有者與管理員可以引用。"""
    if asset_id is None:
        return
    asset = await session.get(Asset, asset_id)
    if asset is None or asset.is_deleted or AssetKind(asset.kind) not in kinds:
        raise ActionError(f"{label}素材不存在或類型不符", 422)
    if asset.source != "upload" and asset.owner_id != user.id and Role.ADMIN not in user.roles:
        raise ActionError(f"{label}素材不存在或類型不符", 422)


async def create_job(
    session: AsyncSession, config: ModelsConfig, region: str, owner: User, data: JobInput
) -> Job:
    tpl = await session.get(Template, data.template_id)
    if tpl is None or not tpl.is_active:
        raise ActionError("模板不存在或已停用", 422)
    if not data.topic.strip():
        raise ActionError("請填寫主題", 422)
    caps = config.video_caps("video_final")
    ratio = data.ratio or tpl.ratio
    if ratio not in caps.ratios:
        raise ActionError(f"模型不支援畫幅 {ratio}", 422)
    target = data.target_duration_s
    if target is not None and not tpl.min_duration_s <= target <= tpl.max_duration_s:
        raise ActionError(f"時長必須在 {tpl.min_duration_s}～{tpl.max_duration_s} 秒之間", 422)
    audio_mode = data.audio_mode or AudioMode(tpl.audio_mode)
    if audio_mode == AudioMode.NATIVE and not caps.supports_audio:
        raise ActionError("目前的模型不支援原生音頻", 422)
    if tpl.video_type == VideoType.TRAINING and audio_mode != AudioMode.TTS:
        raise ActionError("培訓講解片以旁白為主軸，音頻方式必須是 TTS", 422)
    image_kinds = {AssetKind.PRODUCT, AssetKind.IMAGE, AssetKind.KEYFRAME}
    for pid in data.product_asset_ids:
        await _check_asset(session, pid, {AssetKind.PRODUCT, AssetKind.IMAGE}, "商品圖", owner)
    await _check_asset(session, data.logo_asset_id, {AssetKind.LOGO, AssetKind.IMAGE}, "Logo ", owner)
    await _check_asset(session, data.bgm_asset_id, {AssetKind.BGM}, "背景音樂", owner)
    await _check_asset(session, data.image_asset_id, image_kinds, "首幀圖片", owner)
    budget = await get_budget(session, config)
    job = Job(
        owner_id=owner.id,
        template_id=tpl.id,
        template_snapshot=template_snapshot(tpl),
        batch_id=data.batch_id,
        title=data.title.strip()[:200] or data.topic.strip()[:30],
        video_type=tpl.video_type,
        inputs={"topic": data.topic.strip(), "extra": data.extra.strip()},
        options={
            "target_duration_s": target,
            "audio_mode": audio_mode.value,
            "continuous_shots": data.continuous_shots,
            "product_asset_ids": [str(x) for x in data.product_asset_ids],
            "logo_asset_id": str(data.logo_asset_id) if data.logo_asset_id else None,
            "bgm_asset_id": str(data.bgm_asset_id) if data.bgm_asset_id else None,
            "image_asset_id": str(data.image_asset_id) if data.image_asset_id else None,
        },
        status=JobStatus.DRAFT.value,
        phase=JobPhase.DRAFT.value if data.draft_mode else JobPhase.FINAL.value,
        region=region,
        ratio=ratio,
        resolution=tpl.resolution,
        seed=random.randint(1, 2**31 - 1),  # noqa: S311 - 生成種子不需要密碼學隨機
        draft_mode=data.draft_mode,
        continuous_shots=data.continuous_shots,
        budget_cny=budget.per_job_cny,
        actual_cost_cny=0,
        warnings=[],
    )
    session.add(job)
    await session.flush()
    return job


EDITABLE = (JobStatus.STORYBOARD_READY, JobStatus.REJECTED)
# 改了這些欄位，已生成的片段要重做
VIDEO_FIELDS = {
    "visual_prompt",
    "shot_type",
    "camera_move",
    "duration_s",
    "needs_first_frame",
    "first_frame_asset_id",
}


async def update_scene(
    session: AsyncSession, job: Job, scene: Scene, changes: dict[str, object], user: User
) -> None:
    if job.status not in EDITABLE:
        raise ActionError("只有分鏡待確認或已退回時可以編輯")
    if scene.status in IN_FLIGHT:
        raise ActionError("這個分鏡正在生成中")
    if "first_frame_asset_id" in changes and changes["first_frame_asset_id"] is not None:
        await _check_asset(
            session,
            uuid.UUID(str(changes["first_frame_asset_id"])),
            {AssetKind.PRODUCT, AssetKind.IMAGE, AssetKind.KEYFRAME, AssetKind.LAST_FRAME},
            "首幀",
            user,
        )
    for name, value in changes.items():
        setattr(scene, name, value)
    if "first_frame_asset_id" in changes:
        scene.first_frame_generated = False
        if changes["first_frame_asset_id"] is not None:
            scene.needs_first_frame = False
    if VIDEO_FIELDS & changes.keys() and scene.status == SceneStatus.SUCCEEDED:
        scene.status = SceneStatus.PENDING.value
        scene.video_asset_id = None
        scene.last_frame_asset_id = None
    if "narration" in changes:
        scene.audio_asset_id = None
        scene.audio_duration_s = None


def is_owner(job: Job, user: User) -> bool:
    return job.owner_id == user.id


def can_view(job: Job, user: User) -> bool:
    return is_owner(job, user) or bool({Role.ADMIN, Role.REVIEWER} & set(user.roles))


def allowed_actions(job: Job, user: User) -> list[str]:
    roles = set(user.roles)
    manage = is_owner(job, user) or Role.ADMIN in roles
    s = JobStatus(job.status)
    actions: list[str] = []
    if manage:
        if s == JobStatus.DRAFT:
            actions += ["submit"]
        if s in EDITABLE:
            actions += ["edit_storyboard", "regenerate_script", "confirm_storyboard"]
        if s in (
            JobStatus.GENERATING,
            JobStatus.IN_REVIEW,
            JobStatus.REJECTED,
            JobStatus.FAILED,
            JobStatus.BUDGET_EXCEEDED,
        ):
            actions += ["regenerate_scene"]
        if job.phase == JobPhase.DRAFT and s in (JobStatus.IN_REVIEW, JobStatus.REJECTED):
            actions += ["render_final"]
        if s in (JobStatus.FAILED, JobStatus.BUDGET_EXCEEDED):
            actions += ["resume"]
        if s not in (JobStatus.APPROVED, JobStatus.CANCELLED):
            actions += ["cancel"]
    if s == JobStatus.IN_REVIEW and job.phase == JobPhase.FINAL and roles & {Role.REVIEWER, Role.ADMIN}:
        actions += ["review"]
    if s == JobStatus.APPROVED and job.final_asset_id and can_view(job, user):
        actions += ["download"]
    return list(dict.fromkeys(actions))


async def scenes_of(session: AsyncSession, job_id: uuid.UUID) -> list[Scene]:
    return list(
        (await session.scalars(select(Scene).where(Scene.job_id == job_id).order_by(Scene.index))).all()
    )
