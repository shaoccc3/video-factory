"""config/models.yaml 的載入與校驗。格式錯誤時拋出 ModelsConfigError，並指出是哪一欄。"""

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError

Region = Literal["volcengine", "byteplus"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ModelEntry(_Strict):
    id: str = Field(min_length=1)
    price_per_mtok: float | None = Field(default=None, ge=0)
    price_per_image: float | None = Field(default=None, ge=0)
    rpm: int | None = Field(default=None, gt=0)
    concurrency: int | None = Field(default=None, gt=0)


class Models(_Strict):
    script_llm: ModelEntry
    keyframe: ModelEntry
    video_draft: ModelEntry
    video_final: ModelEntry


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
