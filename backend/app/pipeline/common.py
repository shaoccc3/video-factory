"""流水線共用：模型選擇、解析度、時長換算、任務選項讀取。"""

import math
import uuid
from dataclasses import dataclass

from app.core.models_config import ModelKey, ModelsConfig, VideoCapabilities
from app.models import Job
from app.models.enums import AudioMode, JobPhase
from app.pipeline.schemas import SceneDraft
from app.providers.pricing import narration_seconds


@dataclass(frozen=True)
class JobOptions:
    target_duration_s: float | None
    audio_mode: AudioMode
    continuous_shots: bool
    product_asset_ids: tuple[uuid.UUID, ...]
    logo_asset_id: uuid.UUID | None
    bgm_asset_id: uuid.UUID | None
    image_asset_id: uuid.UUID | None


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
    )


def video_model_key(job: Job) -> ModelKey:
    return "video_draft" if job.phase == JobPhase.DRAFT else "video_final"


def job_resolution(job: Job, config: ModelsConfig) -> str:
    caps = config.video_caps(video_model_key(job))
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


def check_storyboard(scenes: list[SceneDraft], rules: StoryboardRules) -> list[str]:
    """返回不符合要求的地方（用來請大模型修正）。"""
    problems = []
    if not rules.min_shots <= len(scenes) <= rules.max_shots:
        problems.append(f"鏡頭數必須在 {rules.min_shots}～{rules.max_shots} 之間，目前 {len(scenes)} 個")
    total = sum(s.duration_s for s in scenes)
    if not rules.narration_driven and not (rules.min_total_s - 0.5 <= total <= rules.max_total_s + 0.5):
        problems.append(
            f"總時長必須在 {rules.min_total_s:.0f}～{rules.max_total_s:.0f} 秒之間，目前 {total:.0f} 秒"
        )
    for i, s in enumerate(scenes, 1):
        if not rules.caps.min_duration_s <= s.duration_s <= rules.caps.max_duration_s:
            problems.append(
                f"第 {i} 個鏡頭時長必須在 {rules.caps.min_duration_s}～{rules.caps.max_duration_s} 秒之間"
            )
    return problems


def normalize_storyboard(scenes: list[SceneDraft], rules: StoryboardRules) -> list[SceneDraft]:
    """把大模型輸出強制調整到規則內：截斷鏡頭數、按旁白估時長、夾緊單鏡頭與總時長。"""
    scenes = scenes[: rules.max_shots]
    caps = rules.caps
    out: list[SceneDraft] = []
    for s in scenes:
        duration = s.duration_s
        if rules.narration_driven and s.narration:
            duration = math.ceil(narration_seconds(s.narration) + 0.5)
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
    return out
