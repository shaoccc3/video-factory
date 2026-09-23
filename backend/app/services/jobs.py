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
    voice_style: str = ""
    music: str = ""
    consistent_voice: bool = False


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


async def active_template(session: AsyncSession, template_id: uuid.UUID) -> Template:
    tpl = await session.get(Template, template_id)
    if tpl is None or not tpl.is_active:
        raise ActionError("模板不存在或已停用", 422)
    return tpl


@dataclass(frozen=True)
class ResolvedOptions:
    ratio: str
    target_duration_s: float | None
    audio_mode: AudioMode


def resolve_options(
    tpl: Template,
    config: ModelsConfig,
    region: str,
    *,
    ratio: str | None,
    target_duration_s: float | None,
    audio_mode: AudioMode | None,
) -> ResolvedOptions:
    """畫幅、時長、聲音方式：套用模板預設並校驗。建立任務與開新片的預估共用，不合法時拋 422。"""
    caps = config.video_caps("video_final")
    resolved_ratio = ratio or tpl.ratio
    if resolved_ratio not in caps.ratios:
        raise ActionError(f"模型不支援畫幅 {resolved_ratio}", 422)
    target = target_duration_s
    if target is not None and not tpl.min_duration_s <= target <= tpl.max_duration_s:
        raise ActionError(f"時長必須在 {tpl.min_duration_s}～{tpl.max_duration_s} 秒之間", 422)
    mode = audio_mode or AudioMode(tpl.audio_mode)
    if mode == AudioMode.TTS and not tts_available(region):
        if audio_mode == AudioMode.TTS:
            raise ActionError("國際版暫不提供 TTS 配音，請改用模型原生聲音", 422)
        mode = AudioMode.NATIVE  # 模板預設 TTS（培訓片）但國際版不提供：改用原生聲音
    if mode == AudioMode.NATIVE and not caps.supports_audio:
        raise ActionError("目前的模型不支援原生聲音", 422)
    if tpl.video_type == VideoType.TRAINING and mode == AudioMode.NONE:
        raise ActionError("培訓講解片以旁白為主軸，不能選擇無聲", 422)
    return ResolvedOptions(ratio=resolved_ratio, target_duration_s=target, audio_mode=mode)


async def create_job(
    session: AsyncSession, config: ModelsConfig, region: str, owner: User, data: JobInput
) -> Job:
    tpl = await active_template(session, data.template_id)
    if not data.topic.strip():
        raise ActionError("請填寫主題", 422)
    resolved = resolve_options(
        tpl,
        config,
        region,
        ratio=data.ratio,
        target_duration_s=data.target_duration_s,
        audio_mode=data.audio_mode,
    )
    ratio, target, audio_mode = resolved.ratio, resolved.target_duration_s, resolved.audio_mode
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
            "voice_style": data.voice_style.strip()[:100],
            "music": data.music.strip()[:100],
            "consistent_voice": data.consistent_voice and audio_mode == AudioMode.NATIVE,
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


@dataclass(frozen=True)
class EstimateInput:
    template_id: uuid.UUID
    target_duration_s: float | None = None
    ratio: str | None = None
    audio_mode: AudioMode | None = None
    draft_mode: bool = False
    resolution: str | None = None


async def preview_job(session: AsyncSession, config: ModelsConfig, region: str, data: EstimateInput) -> Job:
    """開新片的預估用：按 POST /jobs 相同的規則校驗與套用預設，返回不加入會話的任務物件（不寫數據庫）。"""
    tpl = await active_template(session, data.template_id)
    resolved = resolve_options(
        tpl,
        config,
        region,
        ratio=data.ratio,
        target_duration_s=data.target_duration_s,
        audio_mode=data.audio_mode,
    )
    return Job(
        template_id=tpl.id,
        template_snapshot=template_snapshot(tpl),
        video_type=tpl.video_type,
        options={"target_duration_s": resolved.target_duration_s, "audio_mode": resolved.audio_mode.value},
        status=JobStatus.DRAFT.value,
        phase=JobPhase.DRAFT.value if data.draft_mode else JobPhase.FINAL.value,
        region=region,
        ratio=resolved.ratio,
        resolution=data.resolution or tpl.resolution,
        draft_mode=data.draft_mode,
    )


EDITABLE = (JobStatus.STORYBOARD_READY, JobStatus.REJECTED)
# 改了這些欄位，已生成的片段要重做
VIDEO_FIELDS = {
    "visual_prompt",
    "shot_type",
    "camera_move",
    "duration_s",
    "needs_first_frame",
    "first_frame_asset_id",
    "speaker",
    "sound",
}


def tts_available(region: str) -> bool:
    """TTS 只接國內版豆包語音（規格 12 決定 4）。"""
    return region == "volcengine"


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
    video_fields = set(VIDEO_FIELDS)
    if AudioMode(str(job.options.get("audio_mode", AudioMode.NONE))) == AudioMode.NATIVE:
        video_fields.add("narration")  # 原生聲音：旁白在影片裡念，改了就要重做影片
    if video_fields & changes.keys() and scene.status == SceneStatus.SUCCEEDED:
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
