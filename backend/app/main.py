"""FastAPI 入口。啟動時校驗 config/models.yaml，格式錯誤就啟動失敗。"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI

from app.api.health import router as health_router
from app.api.middleware import RequestIdMiddleware
from app.core.db import create_engine
from app.core.logging import configure_logging
from app.core.models_config import load_models_config
from app.core.readiness import postgres_check, storage_check, valkey_check
from app.core.settings import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, json=settings.log_json)
    models_config = load_models_config(settings.models_config_path)
    engine = create_engine(settings.database_url)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        structlog.get_logger(__name__).info("startup", region=settings.ark_region)
        yield
        await engine.dispose()

    app = FastAPI(title="video-factory", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.models_config = models_config
    app.state.engine = engine
    app.state.readiness_checks = {
        "postgres": postgres_check(engine),
        "valkey": valkey_check(settings.valkey_url),
        "storage": storage_check(settings),
    }
    app.add_middleware(RequestIdMiddleware)
    app.include_router(health_router)
    return app


def app_factory() -> FastAPI:
    """uvicorn --factory 使用。"""
    return create_app()
