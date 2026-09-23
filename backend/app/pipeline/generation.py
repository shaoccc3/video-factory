"""關鍵幀（P6）與分鏡影片生成（P7）。一個分鏡一次調用，成功後立即轉存到對象存儲。"""

import shutil
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path

import structlog
from sqlalchemy import select, update

from app.core.models_config import video_dimensions
from app.media.ffmpeg import FFmpegError, run_ffmpeg
from app.models import Asset, Job, Scene
from app.models.enums import AssetKind, AudioMode, JobPhase, JobStatus, SceneStatus
from app.pipeline.common import clip_duration, job_options, job_resolution, video_model_key
from app.providers.base import VideoImageInput, VideoRequest
from app.providers.gateway import CallContext, Gateway
from app.services.assets import NewAsset, model_input_url, sniff_mime, store_asset
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
    parts = [f"{style}{scene.visual_prompt}".strip().rstrip("。")]
    camera = "，".join(p for p in (scene.shot_type, scene.camera_move) if p)
    if camera:
        parts.append(f"鏡頭：{camera}")
    opts = job_options(job)
    if opts.audio_mode == AudioMode.NATIVE:
        # 原生聲音：把要說的話、音效、配樂寫進提示詞，由影片模型直接生成並對口型
        if scene.narration.strip():
            speaker = scene.speaker.strip() or "旁白"
            voice = f"（{opts.voice_style.strip()}）" if opts.voice_style.strip() else ""
            parts.append(f"{speaker}{voice}說：「{scene.narration.strip()}」")
        if scene.sound.strip():
            parts.append(f"音效：{scene.sound.strip()}")
        music = opts.music.strip()
        if music.lower() == "none":
            parts.append("不要背景音樂")
        elif music:
            parts.append(f"配樂：{music}")
    return "。".join(parts) + "。"


def keyframe_size(runtime: Runtime, resolution: str, ratio: str) -> str:
    """關鍵幀尺寸：優先用 models.yaml 的 image_sizes（Seedream 5.0 lite 有最小總像素），沒配置時用影片寬高。"""
    size = (runtime.config.models.keyframe.image_sizes or {}).get(ratio)
    if size:
        return size
    width, height = video_dimensions(resolution, ratio)
    return f"{width}x{height}"


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
    dest = work_dir(runtime, job.id, f"scene-{scene.index}") / f"keyframe-{uuid.uuid4().hex[:8]}.png"
    await gateway.generate_image(
        CallContext(job.id, job.owner_id, scene.id),
        prompt=video_prompt(job, scene),
        size=keyframe_size(runtime, job.resolution, job.ratio),
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


async def _reference_voice(runtime: Runtime, job: Job, scene: Scene) -> Asset | None:
    """聲音一致：第 2 鏡起用第一鏡的聲音作參考音頻。"""
    opts = job_options(job)
    if not (opts.consistent_voice and opts.audio_mode == AudioMode.NATIVE and scene.index > 0):
        return None
    async with runtime.sessionmaker() as session:
        first = await session.scalar(select(Scene).where(Scene.job_id == job.id, Scene.index == 0))
        if first is None or first.audio_asset_id is None:
            return None
        return await session.get(Asset, first.audio_asset_id)


async def _reference_images(runtime: Runtime, scene: Scene, limit: int) -> list[VideoImageInput]:
    images: list[VideoImageInput] = []
    if limit <= 0:
        return images
    async with runtime.sessionmaker() as session:
        for ref_id in scene.ref_asset_ids[:limit]:
            ref = await session.get(Asset, uuid.UUID(ref_id))
            if ref is not None and not ref.is_deleted:
                images.append(VideoImageInput(model_input_url(runtime, ref), "reference_image"))
    return images


# 首幀改作參考圖送出時，在提示詞裡指定它是第一幀（官方文件的參考素材寫法為 @Image1）
FIRST_FRAME_REFERENCE_HINT = "影片第一幀使用 @Image1 的畫面，從這個畫面開始。"


async def build_video_request(
    runtime: Runtime, job: Job, scene: Scene, first_frame: Asset | None
) -> VideoRequest:
    """組裝 Seedance 請求。官方規定：首幀／首尾幀與全能參考（參考圖、影片、音頻）互斥，不能混用。"""
    key = video_model_key(job, runtime.config)
    caps = runtime.config.video_caps(key)
    voice_ref = await _reference_voice(runtime, job, scene)
    wants_voice = (
        voice_ref is not None and "reference_audio" in caps.image_roles and caps.max_reference_audios > 0
    )
    prompt = video_prompt(job, scene)
    adaptive_ratio = False
    images: list[VideoImageInput] = []
    if first_frame is not None and wants_voice and "reference_image" in caps.image_roles:
        # 聲音一致：要送參考音頻，首幀改以參考圖（@Image1）送出，分鏡的參考圖接在後面
        images.append(VideoImageInput(model_input_url(runtime, first_frame), "reference_image"))
        images.extend(await _reference_images(runtime, scene, caps.max_reference_images - 1))
        prompt = f"{FIRST_FRAME_REFERENCE_HINT}{prompt}"
    elif first_frame is not None and "first_frame" in caps.image_roles:
        images.append(VideoImageInput(model_input_url(runtime, first_frame), "first_frame"))
        adaptive_ratio = caps.frames_require_adaptive_ratio
        wants_voice = False
    elif scene.ref_asset_ids and "reference_image" in caps.image_roles:
        images.extend(await _reference_images(runtime, scene, max(1, caps.max_reference_images)))
    audios: list[VideoImageInput] = []
    if wants_voice and voice_ref is not None:
        if caps.reference_audio_needs_visual and not images:
            log.warning(
                "voice_reference_skipped",
                job_id=str(job.id),
                scene=scene.index,
                reason="模型不支援只送參考音頻",
            )
        else:
            audios.append(VideoImageInput(model_input_url(runtime, voice_ref), "reference_audio"))
    audio_mode = job_options(job).audio_mode
    return VideoRequest(
        model_id=runtime.config.models.get(key).id,
        prompt=prompt,
        ratio=job.ratio,
        resolution=job_resolution(job, runtime.config),
        duration_s=clip_duration(scene.duration_s, caps),
        seed=job.seed if caps.supports_seed else None,
        images=tuple(images),
        audios=tuple(audios),
        generate_audio=audio_mode == AudioMode.NATIVE and caps.supports_audio,
        return_last_frame=True,
        watermark=runtime.settings.model_watermark,
        draft=job.phase == JobPhase.DRAFT and caps.supports_draft,
        safety_identifier=str(job.owner_id),
        adaptive_ratio=adaptive_ratio,
    )


REFERENCE_AUDIO_S = 10


def _image_mime(path: Path) -> str:
    """尾幀格式按文件頭判斷：Seedance 返回 JPEG，Mock 生成 PNG。"""
    with path.open("rb") as fh:
        return sniff_mime(fh.read(32)) or "image/png"


async def _extract_voice_reference(
    runtime: Runtime, job: Job, scene: Scene, video: Path, work: Path
) -> Asset | None:
    """聲音一致：第一鏡成功後截取前 10 秒音頻，作為後續鏡頭的參考音頻。"""
    opts = job_options(job)
    if not (opts.consistent_voice and opts.audio_mode == AudioMode.NATIVE and scene.index == 0):
        return None
    dest = work / "voice-reference.mp3"
    try:
        await run_ffmpeg(
            [
                "-i",
                str(video),
                "-vn",
                "-t",
                str(REFERENCE_AUDIO_S),
                "-ac",
                "1",
                "-c:a",
                "libmp3lame",
                str(dest),
            ]
        )
    except FFmpegError:
        log.warning("voice_reference_failed", job_id=str(job.id))  # 片段沒有音軌時略過
        return None
    return await store_asset(
        runtime, NewAsset(dest, AssetKind.VOICE, "audio/mpeg", job.owner_id, job.id, display_name="聲音參考")
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
        video_model_key(job, runtime.config),
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
            NewAsset(
                run.outputs.last_frame,
                AssetKind.LAST_FRAME,
                _image_mime(run.outputs.last_frame),
                job.owner_id,
                job.id,
            ),
        )
    voice_ref = await _extract_voice_reference(runtime, job, scene, run.outputs.video, dest_dir)
    async with runtime.sessionmaker() as session:
        session.add(clip)
        if last is not None:
            session.add(last)
        if voice_ref is not None:
            session.add(voice_ref)
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
                **({"audio_asset_id": voice_ref.id} if voice_ref is not None else {}),
                error_kind=None,
                error_message=None,
            )
        )
        await session.commit()
    shutil.rmtree(dest_dir, ignore_errors=True)
    log.info("scene_succeeded", job_id=str(job.id), scene=scene.index, cost_cny=run.cost_cny)
