"""影片模板：從 config/templates/ 同步到數據庫；渲染提示詞。"""

from pathlib import Path
from typing import Any

import yaml
from jinja2 import StrictUndefined
from jinja2.sandbox import SandboxedEnvironment
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Template
from app.models.enums import AudioMode, VideoType

_env = SandboxedEnvironment(undefined=StrictUndefined, autoescape=False, keep_trailing_newline=False)


class TemplateDef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(pattern=r"^[a-z0-9_-]{2,64}$")
    name: str
    description: str = ""
    video_type: VideoType
    ratio: str
    resolution: str
    min_duration_s: int = Field(gt=0)
    max_duration_s: int = Field(gt=0)
    min_shots: int = Field(gt=0)
    max_shots: int = Field(gt=0)
    audio_mode: AudioMode
    subtitle_required: bool
    style_prefix: str = ""
    prompt_file: str


def load_template_defs(directory: Path) -> list[tuple[TemplateDef, str]]:
    result = []
    for path in sorted(directory.glob("*.yaml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        tdef = TemplateDef.model_validate(data)
        prompt = (directory / tdef.prompt_file).read_text(encoding="utf-8")
        result.append((tdef, prompt))
    return result


async def sync_templates(session: AsyncSession, directory: Path, *, force: bool = False) -> list[str]:
    """新模板直接建立；已存在的只在 force 時覆蓋（避免蓋掉管理員的修改）。返回有變動的 key。"""
    changed = []
    for tdef, prompt in load_template_defs(directory):
        existing = await session.scalar(select(Template).where(Template.key == tdef.key))
        fields = tdef.model_dump(exclude={"prompt_file"})
        fields["video_type"] = tdef.video_type.value
        fields["audio_mode"] = tdef.audio_mode.value
        if existing is None:
            session.add(Template(**fields, prompt_template=prompt, is_active=True, version=1))
            changed.append(tdef.key)
        elif force:
            for name, value in fields.items():
                setattr(existing, name, value)
            existing.prompt_template = prompt
            existing.version += 1
            changed.append(tdef.key)
    await session.flush()
    return changed


def render_prompt(template_source: str, variables: dict[str, Any]) -> str:
    return _env.from_string(template_source).render(**variables).strip()


def template_snapshot(tpl: Template) -> dict[str, object]:
    return {
        "id": str(tpl.id),
        "key": tpl.key,
        "name": tpl.name,
        "video_type": tpl.video_type,
        "ratio": tpl.ratio,
        "resolution": tpl.resolution,
        "min_duration_s": tpl.min_duration_s,
        "max_duration_s": tpl.max_duration_s,
        "min_shots": tpl.min_shots,
        "max_shots": tpl.max_shots,
        "audio_mode": tpl.audio_mode,
        "subtitle_required": tpl.subtitle_required,
        "style_prefix": tpl.style_prefix,
        "prompt_template": tpl.prompt_template,
        "version": tpl.version,
    }
