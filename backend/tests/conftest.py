import uuid
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI

from app.core.settings import Settings
from app.main import create_app
from app.models import Base, User
from app.providers.gateway import Gateway
from app.services.runtime import Runtime, build_gateway, build_runtime


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'test.db'}",
        valkey_url="redis://127.0.0.1:1/0",
        storage_backend="local",
        local_storage_dir=tmp_path / "storage",
        work_dir=tmp_path / "work",
        provider_mode="mock",
        seedance_poll_initial_s=0.001,
        seedance_poll_max_s=0.002,
        provider_retry_base_s=0.001,
        log_json=False,
        readiness_timeout_s=1.0,
        secret_key="test-secret",
    )


@pytest.fixture
async def runtime(settings: Settings) -> AsyncIterator[Runtime]:
    rt = build_runtime(settings)
    async with rt.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield rt
    await rt.aclose()


@pytest.fixture
def gateway(runtime: Runtime) -> Gateway:
    return build_gateway(runtime)


async def make_user(
    runtime: Runtime,
    *,
    roles: tuple[str, ...] = ("creator",),
    email: str | None = None,
    password: str = "password-123",
    daily_budget_cny: float | None = None,
) -> User:
    from app.core.security import hash_password

    async with runtime.sessionmaker() as session:
        user = User(
            email=email or f"{uuid.uuid4().hex[:8]}@example.com",
            display_name="測試用戶",
            password_hash=hash_password(password),
            roles=list(roles),
            is_active=True,
            daily_budget_cny=daily_budget_cny,
            auth_provider="local",
        )
        session.add(user)
        await session.commit()
        return user


@pytest.fixture
async def user(runtime: Runtime) -> User:
    return await make_user(runtime)


@pytest.fixture
def app(settings: Settings, runtime: Runtime) -> FastAPI:
    return create_app(settings, runtime=runtime)


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
