"""config/models.yaml 的載入與校驗。格式錯誤時拋出 ModelsConfigError，並指出是哪一欄。"""

from pathlib import Path
from typing import Annotated, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

Region = Literal["volcengine", "byteplus"]
ModelKey = Literal["script_llm", "keyframe", "video_draft", "video_final", "video_long", "tts"]
VideoModelKey = Literal["video_draft", "video_final", "video_long"]

# Seedance 分辨率對應的像素（以 16:9 為基準，其他畫幅按比例換算）
RESOLUTION_SHORT_SIDE = {"480p": 480, "720p": 720, "1080p": 1080}


def parse_size(value: str) -> tuple[int, int]:
    """解析「寬x高」，例如 1280x720。"""
    w_str, sep, h_str = value.lower().partition("x")
    if not sep or not w_str.isdigit() or not h_str.isdigit() or int(w_str) <= 0 or int(h_str) <= 0:
        raise ValueError(f"尺寸格式應為「寬x高」：{value!r}")
    return int(w_str), int(h_str)


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
    supports_seed: bool = False  # Seedance 2.x 不支援 seed（官方只列 1.x）
    # 帶首幀／尾幀時 ratio 只能傳 adaptive（Seedance 2.5）
    frames_require_adaptive_ratio: bool = False
    # 參考音頻必須搭配參考圖或參考影片（Seedance 2.0 系列不支援只有音頻）
    reference_audio_needs_visual: bool = False
    # 官方寬高表：解析度 → 畫幅 → 「寬x高」；用於估算 token。未填時按短邊推算
    dimensions: dict[str, dict[str, str]] | None = None

    @model_validator(mode="after")
    def _check(self) -> "VideoCapabilities":
        if self.min_duration_s > self.max_duration_s:
            raise ValueError("min_duration_s 不能大於 max_duration_s")
        unknown = set(self.resolutions) - set(RESOLUTION_SHORT_SIDE)
        if unknown:
            raise ValueError(f"未知的解析度：{sorted(unknown)}")
        if self.dimensions is not None:
            for res in self.resolutions:
                missing = [r for r in self.ratios if r not in self.dimensions.get(res, {})]
                if missing:
                    raise ValueError(f"dimensions 缺少 {res} 的畫幅：{missing}")
            for table in self.dimensions.values():
                for size in table.values():
                    parse_size(size)
        return self

    def dimensions_for(self, resolution: str, ratio: str) -> tuple[int, int]:
        """輸出寬高：優先查官方寬高表，沒有時按短邊推算。"""
        size = (self.dimensions or {}).get(resolution, {}).get(ratio)
        return parse_size(size) if size else video_dimensions(resolution, ratio)


class ModelEntry(_Strict):
    id: str = Field(min_length=1)
    price_per_mtok: float | None = Field(default=None, ge=0)
    price_per_mtok_audio: float | None = Field(default=None, ge=0)  # 有聲影片單價；未填則用 price_per_mtok
    # 大模型輸入／輸出分價；未填時按 price_per_mtok 計總 token
    price_per_mtok_input: float | None = Field(default=None, ge=0)
    price_per_mtok_output: float | None = Field(default=None, ge=0)
    # 影片按輸出解析度覆蓋 price_per_mtok
    price_per_mtok_by_resolution: dict[str, Annotated[float, Field(ge=0)]] | None = None
    price_per_image: float | None = Field(default=None, ge=0)
    price_per_kchar: float | None = Field(default=None, ge=0)
    image_sizes: dict[str, str] | None = None  # 關鍵幀：畫幅 → 「寬x高」
    rpm: int | None = Field(default=None, gt=0)
    concurrency: int | None = Field(default=None, gt=0)
    capabilities: VideoCapabilities | None = None

    @model_validator(mode="after")
    def _check(self) -> "ModelEntry":
        if (self.price_per_mtok_input is None) != (self.price_per_mtok_output is None):
            raise ValueError("price_per_mtok_input 與 price_per_mtok_output 要一起填")
        if self.price_per_mtok_by_resolution:
            if self.capabilities is None:
                raise ValueError("price_per_mtok_by_resolution 只用於有 capabilities 的影片模型")
            unknown = set(self.price_per_mtok_by_resolution) - set(self.capabilities.resolutions)
            if unknown:
                raise ValueError(f"price_per_mtok_by_resolution 有未支援的解析度：{sorted(unknown)}")
        for size in (self.image_sizes or {}).values():
            parse_size(size)
        return self


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
