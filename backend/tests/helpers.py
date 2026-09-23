"""測試工具：同步執行的派發器、模板與素材準備。"""

import uuid
from collections import deque
from pathlib import Path
from typing import Any

from sqlalchemy import select, update

from app.core.settings import REPO_ROOT
from app.media.samples import make_test_audio, make_test_image
from app.models import Asset, Job, Template, User
from app.models.enums import AssetKind
from app.pipeline import orchestrator
from app.pipeline.templates import sync_templates
from app.providers.gateway import Gateway
from app.services.assets import NewAsset, store_asset
from app.services.jobs import JobInput, create_job
from app.services.runtime import Runtime


class InlineDispatcher:
    """把派發的步驟放進隊列，drain() 時依序執行（模擬 worker）。"""

    def __init__(self, runtime: Runtime, gateway: Gateway) -> None:
        self.runtime = runtime
        self.gateway = gateway
        self.queue: deque[tuple[str, tuple[uuid.UUID, ...]]] = deque()
        self.log: list[str] = []

    def script(self, job_id: uuid.UUID) -> None:
        self.queue.append(("script", (job_id,)))

    def scene(self, job_id: uuid.UUID, scene_id: uuid.UUID) -> None:
        self.queue.append(("scene", (job_id, scene_id)))

    def compose(self, job_id: uuid.UUID) -> None:
        self.queue.append(("compose", (job_id,)))

    def batch(self, batch_id: uuid.UUID) -> None:
        self.queue.append(("batch", (batch_id,)))

    def keyframe(self, job_id: uuid.UUID, scene_id: uuid.UUID) -> None:
        self.queue.append(("keyframe", (job_id, scene_id)))

    async def drain(self, limit: int = 1000) -> None:
        for _ in range(limit):
            if not self.queue:
                return
            await self.step()
        raise RuntimeError(f"隊列沒有清空，可能有循環：{self.log[-30:]}")

    async def step(self) -> None:
        kind, args = self.queue.popleft()
        self.log.append(kind)
        rt, gw = self.runtime, self.gateway
        if kind == "script":
            await orchestrator.task_script(rt, gw, self, args[0])
        elif kind == "scene":
            await orchestrator.task_scene(rt, gw, self, args[0], args[1])
        elif kind == "compose":
            await orchestrator.task_compose(rt, gw, self, args[0])
        elif kind == "batch":
            await orchestrator.task_batch(rt, self, args[0])
        elif kind == "keyframe":
            await orchestrator.task_keyframe(rt, gw, args[0], args[1])


async def setup_templates(runtime: Runtime, resolution: str = "480p") -> dict[str, Template]:
    """同步模板，並把解析度調低以加快測試。"""
    async with runtime.sessionmaker() as session:
        await sync_templates(session, REPO_ROOT / "config" / "templates")
        await session.execute(update(Template).values(resolution=resolution))
        base = await session.scalar(select(Template).where(Template.key == "marketing"))
        assert base is not None
        session.add(
            Template(
                key="marketing_multi", name="多鏡頭行銷（測試）", description="", video_type="marketing",
                ratio="9:16", resolution=resolution, min_duration_s=15, max_duration_s=30,
                min_shots=3, max_shots=4, audio_mode="native", video_model="video_final",
                subtitle_required=True, style_prefix=base.style_prefix, prompt_template=base.prompt_template,
            )
        )  # fmt: skip
        await session.commit()
        return {t.key: t for t in (await session.scalars(select(Template))).all()}


async def make_asset(runtime: Runtime, owner: User, kind: AssetKind, tmp: Path) -> Asset:
    if kind == AssetKind.BGM:
        path = await make_test_audio(tmp / f"{uuid.uuid4().hex}.mp3", duration_s=3)
        mime = "audio/mpeg"
    else:
        path = await make_test_image(tmp / f"{uuid.uuid4().hex}.png", width=320, height=320, color="0x22aa66")
        mime = "image/png"
    asset = await store_asset(runtime, NewAsset(path, kind, mime, owner.id, source="upload"))
    async with runtime.sessionmaker() as session:
        session.add(asset)
        await session.commit()
    return asset


async def new_job(runtime: Runtime, owner: User, template: Template, **kw: Any) -> Job:
    kw.setdefault("title", "測試任務")
    kw.setdefault("topic", "清晨的茶園，推廣自家綠茶")
    data = JobInput(template_id=template.id, **kw)
    async with runtime.sessionmaker() as session:
        user = await session.get(User, owner.id)
        assert user is not None
        job = await create_job(session, runtime.config, runtime.settings.ark_region, user, data)
        await session.commit()
        return job


async def reload(runtime: Runtime, job_id: uuid.UUID) -> Job:
    async with runtime.sessionmaker() as session:
        job = await session.get(Job, job_id)
        assert job is not None
        return job
