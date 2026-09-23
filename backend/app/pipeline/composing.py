"""配音、字幕（P8）與合成（P9）：composing → in_review。"""

import shutil
import uuid
from pathlib import Path

import structlog
from sqlalchemy import select, update

from app.core.models_config import video_dimensions
from app.media.compose import AI_NOTICE, ClipInput, ComposeSpec, run_compose, target_duration, timeline
from app.media.ffmpeg import probe
from app.media.subtitles import Cue, cues_for_text, to_srt
from app.models import Asset, Job, Scene
from app.models.enums import AssetKind, AudioMode, JobStatus, SceneStatus
from app.pipeline.common import job_options
from app.pipeline.generation import work_dir
from app.pipeline.state import transition
from app.providers.gateway import CallContext, Gateway
from app.services.assets import NewAsset, fetch_to, store_asset
from app.services.runtime import Runtime

log = structlog.get_logger(__name__)

AI_METADATA_KEYS = ("aigc_label", "aigc_producer", "aigc_content_id")


class ComposeError(RuntimeError):
    pass


async def synthesize_voices(runtime: Runtime, gateway: Gateway, job: Job, scenes: list[Scene]) -> None:
    """TTS：每個有旁白、還沒配音的分鏡生成一段語音並記錄時長。"""
    for scene in scenes:
        if not scene.narration.strip() or scene.audio_asset_id is not None:
            continue
        dest = work_dir(runtime, job.id, "voice") / f"scene-{scene.index}-{uuid.uuid4().hex[:6]}.mp3"
        speech = await gateway.synthesize(
            CallContext(job.id, job.owner_id, scene.id), scene.narration, dest=dest
        )
        asset = await store_asset(
            runtime, NewAsset(speech.path, AssetKind.VOICE, "audio/mpeg", job.owner_id, job.id)
        )
        async with runtime.sessionmaker() as session:
            session.add(asset)
            await session.flush()
            await session.execute(
                update(Scene)
                .where(Scene.id == scene.id)
                .values(audio_asset_id=asset.id, audio_duration_s=speech.duration_s)
            )
            await session.commit()
        scene.audio_asset_id = asset.id
        scene.audio_duration_s = speech.duration_s


def ai_metadata(runtime: Runtime, job: Job) -> dict[str, str]:
    platform = runtime.settings.platform_name
    return {
        "title": job.title,
        "comment": f"{AI_NOTICE}（{platform}）",
        "aigc_label": "AI生成",
        "aigc_producer": platform,
        "aigc_content_id": str(job.id),
        "aigc_method": "Seedance 影片生成、Seedream 圖像生成、語音合成",
    }


async def _asset(runtime: Runtime, asset_id: uuid.UUID | None) -> Asset | None:
    if asset_id is None:
        return None
    async with runtime.sessionmaker() as session:
        asset = await session.get(Asset, asset_id)
        return asset if asset is not None and not asset.is_deleted else None


async def compose_job(runtime: Runtime, gateway: Gateway, job_id: uuid.UUID) -> None:
    async with runtime.sessionmaker() as session:
        job = await session.get(Job, job_id)
        if job is None or job.status != JobStatus.COMPOSING:
            return
        scenes = list(
            (await session.scalars(select(Scene).where(Scene.job_id == job.id).order_by(Scene.index))).all()
        )
        session.expunge_all()
    if not scenes or any(s.status != SceneStatus.SUCCEEDED or s.video_asset_id is None for s in scenes):
        raise ComposeError("還有分鏡沒有成功，不能合成")
    opts = job_options(job)
    font_file = runtime.settings.fonts_dir / runtime.settings.font_file
    if not font_file.exists():
        raise ComposeError(f"找不到字體 {font_file.name}，請執行 scripts/fetch_fonts.py")

    if opts.audio_mode == AudioMode.TTS:
        await synthesize_voices(runtime, gateway, job, scenes)

    work = work_dir(runtime, job.id, f"compose-{uuid.uuid4().hex[:6]}")
    clips: list[ClipInput] = []
    for scene in scenes:
        clip_asset = await _asset(runtime, scene.video_asset_id)
        if clip_asset is None:
            raise ComposeError(f"第 {scene.index + 1} 鏡的影片不見了")
        video = await fetch_to(runtime, clip_asset, work / f"clip-{scene.index:02d}.mp4")
        video_s = clip_asset.duration_s or (await probe(video)).duration_s or scene.duration_s
        voice = None
        voice_s = None
        if opts.audio_mode == AudioMode.TTS and scene.audio_asset_id is not None:
            voice_asset = await _asset(runtime, scene.audio_asset_id)
            if voice_asset is not None:
                voice = await fetch_to(runtime, voice_asset, work / f"voice-{scene.index:02d}.mp3")
                voice_s = scene.audio_duration_s or (await probe(voice)).duration_s
        clips.append(
            ClipInput(
                video=video,
                duration_s=target_duration(video_s, voice_s),
                voice=voice,
                voice_duration_s=voice_s,
                native_audio=opts.audio_mode == AudioMode.NATIVE,
            )
        )

    # 字幕：時間軸與合成一致；有旁白音頻時按音頻時長分配，否則按片段時長
    tl = timeline([2.0] + [c.duration_s for c in clips], 0.5)
    subtitle_required = (
        bool(job.template_snapshot.get("subtitle_required")) or opts.audio_mode == AudioMode.TTS
    )
    cues: list[Cue] = []
    for k, (scene, clip) in enumerate(zip(scenes, clips, strict=True)):
        span = clip.voice_duration_s or max(1.0, clip.duration_s - 0.5)
        cues += cues_for_text(scene.narration, tl.clip_starts[k] + 0.25, span)
    subtitles = None
    if subtitle_required and cues:
        subtitles = work / "subtitles.srt"
        subtitles.write_text(to_srt(cues), encoding="utf-8")

    logo_asset = await _asset(runtime, opts.logo_asset_id)
    logo = (
        await fetch_to(runtime, logo_asset, work / f"logo{Path(logo_asset.storage_key).suffix}")
        if logo_asset
        else None
    )
    bgm_asset = await _asset(runtime, opts.bgm_asset_id)
    bgm = (
        await fetch_to(runtime, bgm_asset, work / f"bgm{Path(bgm_asset.storage_key).suffix}")
        if bgm_asset
        else None
    )

    width, height = video_dimensions(job.resolution, job.ratio)
    spec = ComposeSpec(
        width=width,
        height=height,
        clips=clips,
        title=job.title,
        font_file=font_file,
        fonts_dir=runtime.settings.fonts_dir,
        font_family=runtime.settings.font_family,
        metadata=ai_metadata(runtime, job),
        subtitles=subtitles,
        logo=logo,
        bgm=bgm,
    )
    final_path, cover_path = work / "final.mp4", work / "cover.jpg"
    await run_compose(spec, work / "tmp", final_path, cover_path)

    info = await probe(final_path)
    missing = [k for k in AI_METADATA_KEYS if not info.tags.get(k)]
    if missing or info.video_codec != "h264" or info.audio_codec != "aac":
        raise ComposeError(f"成片校驗失敗：缺少標識 {missing} 或編碼不符")

    final = await store_asset(
        runtime,
        NewAsset(
            final_path, AssetKind.FINAL, "video/mp4", job.owner_id, job.id, display_name=f"{job.title}.mp4"
        ),
    )
    cover = await store_asset(
        runtime, NewAsset(cover_path, AssetKind.COVER, "image/jpeg", job.owner_id, job.id)
    )
    srt = None
    if subtitles is not None:
        srt = await store_asset(
            runtime,
            NewAsset(
                subtitles,
                AssetKind.SUBTITLE,
                "application/x-subrip",
                job.owner_id,
                job.id,
                display_name=f"{job.title}.srt",
            ),
        )
    async with runtime.sessionmaker() as session:
        session.add_all([a for a in (final, cover, srt) if a is not None])
        await session.flush()
        ok = await transition(
            session,
            job.id,
            JobStatus.IN_REVIEW,
            from_statuses=[JobStatus.COMPOSING],
            final_asset_id=final.id,
            cover_asset_id=cover.id,
            subtitle_asset_id=srt.id if srt else None,
            error_kind=None,
            error_code=None,
            error_message=None,
        )
        await session.commit()
    shutil.rmtree(work, ignore_errors=True)
    log.info("job_composed", job_id=str(job.id), duration_s=info.duration_s, moved=ok)
