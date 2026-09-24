"""FastAPI 入口。啟動時校驗 config/models.yaml，格式錯誤就啟動失敗。"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI

from app.api.health import router as health_router
from app.api.middleware import RequestIdMiddleware
from app.api.router import api_router
from app.core.logging import configure_logging
from app.core.models_config import load_models_config
from app.core.readiness import Check, database_check, ffmpeg_check, fonts_check, storage_check, valkey_check
from app.core.settings import DEV_SECRET_KEY, Settings, get_settings
from app.pipeline.orchestrator import Dispatcher
from app.services.runtime import Runtime, build_gateway, build_runtime


def create_app(
    settings: Settings | None = None, *, runtime: Runtime | None = None, dispatcher: Dispatcher | None = None
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, json=settings.log_json)
    secret = settings.secret_key.get_secret_value()
    if (settings.provider_mode == "live" or settings.cookie_secure) and (
        secret == DEV_SECRET_KEY or len(secret) < 32
    ):
        raise RuntimeError("正式環境必須設定 SECRET_KEY（至少 32 位隨機字串）")
    config = runtime.config if runtime else load_models_config(settings.models_config_path)
    rt = runtime or build_runtime(settings, config=config)
    owns_runtime = runtime is None

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        structlog.get_logger(__name__).info(
            "startup", region=settings.ark_region, provider_mode=settings.provider_mode
        )
        yield
        if owns_runtime:
            await rt.aclose()

    app = FastAPI(title="video-factory", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.models_config = config
    app.state.runtime = rt
    app.state.gateway = build_gateway(rt)
    if dispatcher is None:
        from app.workers import app as celery_app
        from app.workers.dispatch import CeleryDispatcher

        dispatcher = CeleryDispatcher(celery_app)
    app.state.dispatcher = dispatcher
    checks: dict[str, Check] = {
        "database": database_check(rt.engine),
        "storage": storage_check(rt.storage),
        "fonts": fonts_check(settings.fonts_dir / settings.font_file),
        "ffmpeg": ffmpeg_check(),
    }
    if settings.broker_url.startswith(("redis://", "rediss://")):
        checks["valkey"] = valkey_check(settings.valkey_url)
    app.state.readiness_checks = checks
    app.add_middleware(RequestIdMiddleware)
    app.include_router(health_router)
    app.include_router(api_router)
    return app


def app_factory() -> FastAPI:
    """uvicorn --factory 使用。"""
    return create_app()
