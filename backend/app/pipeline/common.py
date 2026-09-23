"""流水線共用：模型選擇、解析度、時長換算、任務選項讀取。"""

import math
import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from app.core.models_config import ModelsConfig, VideoCapabilities, VideoModelKey
from app.models import Job, Scene
from app.models.enums import AudioMode, JobPhase, VideoType
from app.pipeline.schemas import SceneDraft
from app.providers.pricing import CHARS_PER_SECOND, narration_seconds


@dataclass(frozen=True)
class JobOptions:
    target_duration_s: float | None
    audio_mode: AudioMode
    continuous_shots: bool
    product_asset_ids: tuple[uuid.UUID, ...]
    logo_asset_id: uuid.UUID | None
    bgm_asset_id: uuid.UUID | None
    image_asset_id: uuid.UUID | None
    voice_style: str = ""
    music: str = ""
    consistent_voice: bool = False


def _uuid(value: object) -> uuid.UUID | None:
    return uuid.UUID(str(value)) if value else None


def job_options(job: Job) -> JobOptions:
    o = job.options
    target = o.get("target_duration_s")
    return JobOptions(
        target_duration_s=float(target) if target else None,  # type: ignore[arg-type]
        audio_mode=AudioMode(str(o.get("audio_mode", AudioMode.NONE))),
        continuous_shots=bool(o.get("continuous_shots", False)),
        product_asset_ids=tuple(uuid.UUID(str(x)) for x in o.get("product_asset_ids", []) or []),  # type: ignore[attr-defined]
        logo_asset_id=_uuid(o.get("logo_asset_id")),
        bgm_asset_id=_uuid(o.get("bgm_asset_id")),
        image_asset_id=_uuid(o.get("image_asset_id")),
        voice_style=str(o.get("voice_style", "") or ""),
        music=str(o.get("music", "") or ""),
        consistent_voice=bool(o.get("consistent_voice", False)),
    )


def video_model_key(job: Job, config: ModelsConfig | None = None) -> VideoModelKey:
    """樣片用 video_draft；正片用模板指定的模型（video_long 未配置時退回 video_final）。"""
    if job.phase == JobPhase.DRAFT:
        return "video_draft"
    wanted = str(job.template_snapshot.get("video_model", "video_final"))
    if wanted == "video_long" and (config is None or config.models.has("video_long")):
        return "video_long"
    return "video_final"


def voice_reference_usable(config: ModelsConfig, job: Job, scenes: Sequence[Scene]) -> bool:
    """聲音一致的參考音頻能否送出。模型要求搭配參考圖時（Seedance 2.0 系列），第 2 鏡起至少要有一鏡帶圖。"""
    caps = config.video_caps(video_model_key(job, config))
    if "reference_audio" not in caps.image_roles or caps.max_reference_audios == 0:
        return False
    if not caps.reference_audio_needs_visual or job_options(job).continuous_shots:
        return True
    return any(
        s.needs_first_frame or s.first_frame_asset_id or s.ref_asset_ids for s in scenes if s.index > 0
    )


def job_resolution(job: Job, config: ModelsConfig) -> str:
    caps = config.video_caps(video_model_key(job, config))
    if job.phase == JobPhase.DRAFT or job.resolution not in caps.resolutions:
        return caps.resolutions[0] if job.phase == JobPhase.DRAFT else caps.resolutions[-1]
    return job.resolution


def clip_duration(duration_s: float, caps: VideoCapabilities) -> int:
    return int(max(caps.min_duration_s, min(caps.max_duration_s, round(duration_s))))


@dataclass(frozen=True)
class StoryboardRules:
    min_shots: int
    max_shots: int
    min_total_s: float
    max_total_s: float
    target_total_s: float
    caps: VideoCapabilities
    narration_driven: bool  # 培訓片：時長按旁白估算
    native_audio: bool = False  # 旁白由影片模型在鏡頭內念出：字數不能超過鏡頭時長


def storyboard_rules(job: Job, config: ModelsConfig) -> StoryboardRules:
    """分鏡約束：鏡頭數、總時長與目標時長來自模板快照，單鏡時長上下限來自模型能力表。"""
    snap = job.template_snapshot
    caps = config.video_caps(video_model_key(job, config))
    opts = job_options(job)
    min_total, max_total = float(snap["min_duration_s"]), float(snap["max_duration_s"])  # type: ignore[arg-type]
    target = opts.target_duration_s or (min_total + max_total) / 2
    return StoryboardRules(
        min_shots=int(snap["min_shots"]),  # type: ignore[call-overload]
        max_shots=int(snap["max_shots"]),  # type: ignore[call-overload]
        min_total_s=min_total,
        max_total_s=max_total,
        target_total_s=min(max(target, min_total), max_total),
        caps=caps,
        narration_driven=job.video_type == VideoType.TRAINING,
        native_audio=opts.audio_mode == AudioMode.NATIVE,
    )


def check_storyboard(scenes: list[SceneDraft], rules: StoryboardRules) -> list[str]:
    """返回不符合要求的地方（用來請大模型修正）。"""
    problems = []
    if not rules.min_shots <= len(scenes) <= rules.max_shots:
        problems.append(f"鏡頭數必須在 {rules.min_shots}～{rules.max_shots} 之間，目前 {len(scenes)} 個")
    total = sum(s.duration_s for s in scenes)
    if rules.narration_driven:
        spoken = sum(narration_seconds(s.narration) for s in scenes)
        if not rules.min_total_s * 0.9 <= spoken <= rules.max_total_s:
            problems.append(
                f"旁白總長約 {spoken:.0f} 秒，需在 {rules.min_total_s:.0f}～{rules.max_total_s:.0f} 秒之間"
                f"（每秒約 4.5 字），請調整旁白字數或鏡頭數"
            )
    elif not (rules.min_total_s - 0.5 <= total <= rules.max_total_s + 0.5):
        problems.append(
            f"總時長必須在 {rules.min_total_s:.0f}～{rules.max_total_s:.0f} 秒之間，目前 {total:.0f} 秒"
        )
    for i, s in enumerate(scenes, 1):
        if not rules.caps.min_duration_s <= s.duration_s <= rules.caps.max_duration_s:
            problems.append(
                f"第 {i} 個鏡頭時長必須在 {rules.caps.min_duration_s}～{rules.caps.max_duration_s} 秒之間"
            )
        if rules.native_audio and narration_seconds(s.narration) > s.duration_s + 0.5:
            limit = int(s.duration_s * CHARS_PER_SECOND)
            problems.append(f"第 {i} 個鏡頭旁白太長：{s.duration_s:.0f} 秒最多約 {limit} 字，請精簡")
    return problems


_CUT_AT = "。！？；，、,.!?;"


def trim_narration(text: str, seconds: float) -> str:
    """旁白超過鏡頭能念完的長度時，在最後一個標點處截斷；沒有標點就硬截。"""
    limit = int(seconds * CHARS_PER_SECOND)
    if narration_seconds(text) <= seconds or limit <= 0:
        return text
    kept, count = "", 0
    for ch in text:
        if not ch.isspace():
            count += 1
        if count > limit:
            break
        kept += ch
    cut = max(kept.rfind(p) for p in _CUT_AT)
    return (kept[: cut + 1] if cut >= limit // 2 else kept).strip()


def normalize_storyboard(scenes: list[SceneDraft], rules: StoryboardRules) -> list[SceneDraft]:
    """把大模型輸出強制調整到規則內：截斷鏡頭數、按旁白估時長、夾緊單鏡頭與總時長。"""
    scenes = scenes[: rules.max_shots]
    caps = rules.caps
    out: list[SceneDraft] = []
    for s in scenes:
        duration = s.duration_s
        if rules.narration_driven and s.narration:
            duration = math.ceil(narration_seconds(s.narration) + 0.5)
        elif rules.native_audio and s.narration:
            # 原生聲音：鏡頭至少要長到能念完旁白
            duration = max(duration, math.ceil(narration_seconds(s.narration) + 0.5))
        out.append(s.model_copy(update={"duration_s": float(clip_duration(duration, caps))}))
    if not rules.narration_driven and out:
        total = sum(s.duration_s for s in out)
        goal = min(max(total, rules.min_total_s), rules.max_total_s)
        if abs(goal - total) > 0.5:
            factor = goal / total
            out = [
                s.model_copy(update={"duration_s": float(clip_duration(s.duration_s * factor, caps))})
                for s in out
            ]
    if rules.native_audio:
        out = [s.model_copy(update={"narration": trim_narration(s.narration, s.duration_s)}) for s in out]
    return out
