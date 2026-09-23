"""Celery 任務：每個任務在獨立的事件循環裡組裝運行時並執行流水線步驟。"""

import asyncio
import uuid
from collections.abc import Awaitable, Callable

import structlog

from app.core.logging import configure_logging
from app.core.settings import get_settings
from app.pipeline import orchestrator
from app.providers.gateway import Gateway
from app.services.runtime import Runtime, build_gateway, build_runtime
from app.workers import app
from app.workers.dispatch import TASK_BATCH, TASK_COMPOSE, TASK_SCENE, TASK_SCRIPT, CeleryDispatcher

_settings = get_settings()
configure_logging(_settings.log_level, json=_settings.log_json)
log = structlog.get_logger(__name__)


def _run(step: Callable[[Runtime, Gateway, CeleryDispatcher], Awaitable[None]], **context: str) -> None:
    async def main() -> None:
        runtime = build_runtime(_settings, null_pool=True)
        try:
            await step(runtime, build_gateway(runtime), CeleryDispatcher(app))
        finally:
            await runtime.aclose()

    structlog.contextvars.bind_contextvars(**context)
    try:
        asyncio.run(main())
    finally:
        structlog.contextvars.clear_contextvars()


@app.task(name="video_factory.ping")
def ping() -> str:
    return "pong"


@app.task(name=TASK_SCRIPT)
def script(job_id: str) -> None:
    jid = uuid.UUID(job_id)
    _run(lambda rt, gw, d: orchestrator.task_script(rt, gw, d, jid), job_id=job_id)


@app.task(name=TASK_SCENE)
def scene(job_id: str, scene_id: str) -> None:
    jid, sid = uuid.UUID(job_id), uuid.UUID(scene_id)
    _run(lambda rt, gw, d: orchestrator.task_scene(rt, gw, d, jid, sid), job_id=job_id, scene_id=scene_id)


@app.task(name=TASK_COMPOSE)
def compose(job_id: str) -> None:
    jid = uuid.UUID(job_id)
    _run(lambda rt, gw, d: orchestrator.task_compose(rt, gw, d, jid), job_id=job_id)


@app.task(name=TASK_BATCH)
def batch(batch_id: str) -> None:
    bid = uuid.UUID(batch_id)
    _run(lambda rt, gw, d: orchestrator.task_batch(rt, d, bid), batch_id=batch_id)
