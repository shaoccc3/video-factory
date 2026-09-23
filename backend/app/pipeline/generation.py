"""關鍵幀（P6）與分鏡影片生成（P7）。一個分鏡一次調用，成功後立即轉存到對象存儲。"""

import shutil
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path

import structlog
from sqlalchemy import select, update

from app.core.models_config import video_dimensions
from app.models import Asset, Job, Scene
from app.models.enums import AssetKind, AudioMode, JobPhase, JobStatus, SceneStatus
from app.pipeline.common import clip_duration, job_options, job_resolution, video_model_key
from app.providers.base import VideoImageInput, VideoRequest
from app.providers.gateway import CallContext, Gateway
from app.services.assets import NewAsset, model_input_url, store_asset
from app.services.runtime import Runtime

log = structlog.get_logger(__name__)


def work_dir(runtime: Runtime, job_id: uuid.UUID, name: str) -> Path:
    path = runtime.settings.work_dir / str(job_id) / name
    path.mkdir(parents=True, exist_ok=True)
    return path


def cancelled_checker(runtime: Runtime, job_id: uuid.UUID) -> Callable[[], Awaitable[bool]]:
    async def is_cancelled() -> bool:
        async with runtime.sessionmaker() as session:
            status = await session.scalar(select(Job.status).where(Job.id == job_id))
            return status != JobStatus.GENERATING

    return is_cancelled


def video_prompt(job: Job, scene: Scene) -> str:
    style = str(job.template_snapshot.get("style_prefix", "") or "")
    parts = [f"{style}{scene.visual_prompt}".strip()]
    camera = "，".join(p for p in (scene.shot_type, scene.camera_move) if p)
    if camera:
        parts.append(f"鏡頭：{camera}")
    return "。".join(parts)


async def ensure_keyframe(runtime: Runtime, gateway: Gateway, job: Job, scene: Scene) -> uuid.UUID | None:
    """需要首幀且還沒有時，用 Seedream 生成（商品圖作參考圖）。返回首幀素材 id。"""
    if scene.first_frame_asset_id is not None or not scene.needs_first_frame:
        return scene.first_frame_asset_id
    async with runtime.sessionmaker() as session:
        refs = []
        for ref_id in scene.ref_asset_ids:
            asset = await session.get(Asset, uuid.UUID(ref_id))
            if asset is not None and not asset.is_deleted:
                refs.append(model_input_url(runtime, asset))
    width, height = video_dimensions(job.resolution, job.ratio)
    dest = work_dir(runtime, job.id, f"scene-{scene.index}") / f"keyframe-{uuid.uuid4().hex[:8]}.png"
    await gateway.generate_image(
        CallContext(job.id, job.owner_id, scene.id),
        prompt=video_prompt(job, scene),
        size=f"{width}x{height}",
        seed=job.seed + scene.index,
        ref_image_urls=tuple(refs),
        dest=dest,
    )
    asset = await store_asset(
        runtime,
        NewAsset(
            dest,
            AssetKind.KEYFRAME,
            "image/png",
            job.owner_id,
            job.id,
            display_name=f"第{scene.index + 1}鏡首幀",
        ),
    )
    async with runtime.sessionmaker() as session:
        session.add(asset)
        await session.flush()
        await session.execute(
            update(Scene)
            .where(Scene.id == scene.id)
            .values(first_frame_asset_id=asset.id, first_frame_generated=True)
        )
        await session.commit()
    return asset.id


async def _first_frame_for(runtime: Runtime, job: Job, scene: Scene, own: uuid.UUID | None) -> Asset | None:
    async with runtime.sessionmaker() as session:
        if own is not None:
            return await session.get(Asset, own)
        if job_options(job).continuous_shots and scene.index > 0:
            prev = await session.scalar(
                select(Scene).where(Scene.job_id == job.id, Scene.index == scene.index - 1)
            )
            if prev is not None and prev.last_frame_asset_id is not None:
                return await session.get(Asset, prev.last_frame_asset_id)
    return None


async def build_video_request(
    runtime: Runtime, job: Job, scene: Scene, first_frame: Asset | None
) -> VideoRequest:
    key = video_model_key(job)
    caps = runtime.config.video_caps(key)
    images: list[VideoImageInput] = []
    if first_frame is not None and "first_frame" in caps.image_roles:
        images.append(VideoImageInput(model_input_url(runtime, first_frame), "first_frame"))
    elif scene.ref_asset_ids and "reference_image" in caps.image_roles:
        async with runtime.sessionmaker() as session:
            for ref_id in scene.ref_asset_ids[:4]:
                ref = await session.get(Asset, uuid.UUID(ref_id))
                if ref is not None and not ref.is_deleted:
                    images.append(VideoImageInput(model_input_url(runtime, ref), "reference_image"))
    audio_mode = job_options(job).audio_mode
    return VideoRequest(
        model_id=runtime.config.models.get(key).id,
        prompt=video_prompt(job, scene),
        ratio=job.ratio,
        resolution=job_resolution(job, runtime.config),
        duration_s=clip_duration(scene.duration_s, caps),
        seed=job.seed,
        images=tuple(images),
        generate_audio=audio_mode == AudioMode.NATIVE and caps.supports_audio,
        return_last_frame=True,
        watermark=runtime.settings.model_watermark,
        draft=job.phase == JobPhase.DRAFT and caps.supports_draft,
        safety_identifier=str(job.owner_id),
    )


async def _set_scene(runtime: Runtime, scene_id: uuid.UUID, **values: object) -> None:
    async with runtime.sessionmaker() as session:
        await session.execute(update(Scene).where(Scene.id == scene_id).values(**values))
        await session.commit()


async def generate_scene_video(
    runtime: Runtime, gateway: Gateway, job_id: uuid.UUID, scene_id: uuid.UUID
) -> None:
    """生成一個分鏡的影片。異常向上拋，由編排器記錄到分鏡與任務上。"""
    async with runtime.sessionmaker() as session:
        job = await session.get(Job, job_id)
        scene = await session.get(Scene, scene_id)
        if job is None or scene is None:
            return
        if job.status != JobStatus.GENERATING or scene.status != SceneStatus.QUEUED:
            return
        session.expunge_all()

    if scene.needs_first_frame and scene.first_frame_asset_id is None:
        await _set_scene(runtime, scene.id, status=SceneStatus.KEYFRAME.value)
    own_first = await ensure_keyframe(runtime, gateway, job, scene)
    first_frame = await _first_frame_for(runtime, job, scene, own_first)
    request = await build_video_request(runtime, job, scene, first_frame)
    await _set_scene(runtime, scene.id, status=SceneStatus.RUNNING.value)

    async def on_created(task_id: str) -> None:
        await _set_scene(runtime, scene.id, remote_task_id=task_id)

    dest_dir = work_dir(runtime, job.id, f"scene-{scene.index}-a{scene.attempt}")
    run = await gateway.run_video(
        CallContext(job.id, job.owner_id, scene.id, is_cancelled=cancelled_checker(runtime, job.id)),
        video_model_key(job),
        request,
        dest_dir=dest_dir,
        existing_task_id=scene.remote_task_id,
        on_created=on_created,
    )
    clip = await store_asset(
        runtime,
        NewAsset(
            run.outputs.video,
            AssetKind.CLIP,
            "video/mp4",
            job.owner_id,
            job.id,
            display_name=f"第{scene.index + 1}鏡",
        ),
    )
    last = None
    if run.outputs.last_frame is not None:
        last = await store_asset(
            runtime,
            NewAsset(run.outputs.last_frame, AssetKind.LAST_FRAME, "image/png", job.owner_id, job.id),
        )
    async with runtime.sessionmaker() as session:
        session.add(clip)
        if last is not None:
            session.add(last)
        await session.flush()
        await session.execute(
            update(Scene)
            .where(Scene.id == scene.id, Scene.status == SceneStatus.RUNNING.value)
            .values(
                status=SceneStatus.SUCCEEDED.value,
                video_asset_id=clip.id,
                last_frame_asset_id=last.id if last else None,
                remote_task_id=None,
                is_draft=job.phase == JobPhase.DRAFT,
                error_kind=None,
                error_message=None,
            )
        )
        await session.commit()
    shutil.rmtree(dest_dir, ignore_errors=True)
    log.info("scene_succeeded", job_id=str(job.id), scene=scene.index, cost_cny=run.cost_cny)
