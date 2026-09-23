"""config/models.yaml 的載入與校驗。格式錯誤時拋出 ModelsConfigError，並指出是哪一欄。"""

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

Region = Literal["volcengine", "byteplus"]
ModelKey = Literal["script_llm", "keyframe", "video_draft", "video_final", "video_long", "tts"]
VideoModelKey = Literal["video_draft", "video_final", "video_long"]

# Seedance 分辨率對應的像素（以 16:9 為基準，其他畫幅按比例換算）
RESOLUTION_SHORT_SIDE = {"480p": 480, "720p": 720, "1080p": 1080}


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class VideoCapabilities(_Strict):
    """Seedance 模型能力表：換模型時只改這裡。"""

    resolutions: tuple[str, ...] = Field(min_length=1)
    ratios: tuple[str, ...] = Field(min_length=1)
    min_duration_s: int = Field(gt=0)
    max_duration_s: int = Field(gt=0)
    fps: int = Field(gt=0)
    supports_draft: bool = False
    supports_audio: bool = False
    # content 項目可用的 role：first_frame、last_frame、reference_image、reference_video、reference_audio
    image_roles: tuple[str, ...] = ()
    max_reference_images: int = Field(default=0, ge=0)
    max_reference_videos: int = Field(default=0, ge=0)
    max_reference_audios: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def _check(self) -> "VideoCapabilities":
        if self.min_duration_s > self.max_duration_s:
            raise ValueError("min_duration_s 不能大於 max_duration_s")
        unknown = set(self.resolutions) - set(RESOLUTION_SHORT_SIDE)
        if unknown:
            raise ValueError(f"未知的解析度：{sorted(unknown)}")
        return self


class ModelEntry(_Strict):
    id: str = Field(min_length=1)
    price_per_mtok: float | None = Field(default=None, ge=0)
    price_per_mtok_audio: float | None = Field(default=None, ge=0)  # 有聲影片單價；未填則用 price_per_mtok
    price_per_image: float | None = Field(default=None, ge=0)
    price_per_kchar: float | None = Field(default=None, ge=0)
    rpm: int | None = Field(default=None, gt=0)
    concurrency: int | None = Field(default=None, gt=0)
    capabilities: VideoCapabilities | None = None


class Models(_Strict):
    script_llm: ModelEntry
    keyframe: ModelEntry
    video_draft: ModelEntry
    video_final: ModelEntry
    video_long: ModelEntry | None = None  # 選用：Seedance 2.5 長鏡頭
    tts: ModelEntry

    @model_validator(mode="after")
    def _check(self) -> "Models":
        for key in ("video_draft", "video_final", "video_long"):
            entry = getattr(self, key)
            if entry is not None and entry.capabilities is None:
                raise ValueError(f"{key} 缺少 capabilities")
        return self

    def get(self, key: ModelKey) -> ModelEntry:
        entry: ModelEntry | None = getattr(self, key)
        if entry is None:
            raise KeyError(f"models.yaml 沒有配置 {key}")
        return entry

    def has(self, key: ModelKey) -> bool:
        return getattr(self, key) is not None


class Budget(_Strict):
    per_job_cny: float = Field(gt=0)
    per_user_daily_cny: float = Field(gt=0)


class ModelsConfig(_Strict):
    region: Region
    base_url: dict[Region, str]
    currency: dict[Region, str]
    fx_to_cny: dict[str, float]
    models: Models
    budget: Budget

    @model_validator(mode="after")
    def _check(self) -> "ModelsConfig":
        for region, cur in self.currency.items():
            if cur not in self.fx_to_cny:
                raise ValueError(f"fx_to_cny 缺少 {region} 的幣種 {cur}")
        return self

    def to_cny(self, amount: float, region: Region) -> float:
        return amount * self.fx_to_cny[self.currency[region]]

    def video_caps(self, key: ModelKey) -> VideoCapabilities:
        caps = self.models.get(key).capabilities
        if caps is None:
            raise KeyError(f"{key} 沒有影片能力表")
        return caps


class ModelsConfigError(RuntimeError):
    """models.yaml 無法載入或校驗失敗。"""


def _format_errors(path: Path, exc: ValidationError) -> str:
    lines = [f"{path} 校驗失敗："]
    for err in exc.errors():
        loc = ".".join(str(p) for p in err["loc"]) or "(根)"
        lines.append(f"  - {loc}：{err['msg']}")
    return "\n".join(lines)


def load_models_config(path: Path) -> ModelsConfig:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ModelsConfigError(f"找不到 {path}") from exc
    except yaml.YAMLError as exc:
        raise ModelsConfigError(f"{path} 不是合法的 YAML：{exc}") from exc
    try:
        return ModelsConfig.model_validate(raw)
    except ValidationError as exc:
        raise ModelsConfigError(_format_errors(path, exc)) from exc


def video_dimensions(resolution: str, ratio: str) -> tuple[int, int]:
    """按解析度與畫幅算輸出寬高（偶數像素）。短邊 = 解析度數字。"""
    short = RESOLUTION_SHORT_SIDE[resolution]
    w_str, h_str = ratio.split(":")
    w_r, h_r = int(w_str), int(h_str)
    if w_r >= h_r:
        width, height = short * w_r / h_r, float(short)
    else:
        width, height = float(short), short * h_r / w_r
    return int(round(width / 2) * 2), int(round(height / 2) * 2)
