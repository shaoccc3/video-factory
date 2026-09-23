"""運行時依賴的組裝：API 進程與 Celery worker 共用。"""

from dataclasses import dataclass
from typing import TYPE_CHECKING

import httpx
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.models_config import ModelsConfig, load_models_config
from app.core.settings import Settings
from app.core.storage import Storage, create_storage
from app.providers.base import Providers
from app.providers.ratelimit import MemoryRateLimiter, RateLimiter, RedisRateLimiter
from app.providers.registry import build_providers

if TYPE_CHECKING:
    from app.providers.gateway import Gateway


@dataclass
class Runtime:
    settings: Settings
    config: ModelsConfig
    engine: AsyncEngine
    sessionmaker: async_sessionmaker[AsyncSession]
    storage: Storage
    providers: Providers
    limiter: RateLimiter

    async def aclose(self) -> None:
        await self.engine.dispose()


def build_runtime(
    settings: Settings,
    *,
    config: ModelsConfig | None = None,
    providers: Providers | None = None,
    storage: Storage | None = None,
    limiter: RateLimiter | None = None,
    null_pool: bool = False,
) -> Runtime:
    config = config or load_models_config(settings.models_config_path)
    kwargs: dict[str, object] = {"poolclass": NullPool} if null_pool else {"pool_pre_ping": True}
    engine = create_async_engine(settings.database_url, **kwargs)
    if limiter is None:
        limiter = (
            RedisRateLimiter(settings.valkey_url)
            if settings.valkey_url.startswith(("redis://", "rediss://")) and settings.provider_mode == "live"
            else MemoryRateLimiter()
        )
    return Runtime(
        settings=settings,
        config=config,
        engine=engine,
        sessionmaker=async_sessionmaker(engine, expire_on_commit=False),
        storage=storage or create_storage(settings),
        providers=providers or build_providers(settings, config),
        limiter=limiter,
    )


def download_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=15.0))


def build_gateway(runtime: Runtime) -> "Gateway":
    from app.providers.gateway import Gateway
    from app.services.budget import BudgetGuard
    from app.services.recorder import CallRecorder

    return Gateway(
        settings=runtime.settings,
        config=runtime.config,
        providers=runtime.providers,
        limiter=runtime.limiter,
        recorder=CallRecorder(runtime.sessionmaker),
        budget=BudgetGuard(runtime.sessionmaker, runtime.config),
    )
