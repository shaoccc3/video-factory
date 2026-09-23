"""/readyz 的依賴檢查：PostgreSQL、Valkey、對象存儲。"""

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass

import redis.asyncio as redis
import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.core.storage import Storage

Check = Callable[[], Awaitable[None]]
log = structlog.get_logger(__name__)


@dataclass(frozen=True)
class CheckResult:
    name: str
    ok: bool
    error: str | None = None


def postgres_check(engine: AsyncEngine) -> Check:
    async def check() -> None:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))

    return check


def valkey_check(url: str) -> Check:
    async def check() -> None:
        client = redis.from_url(url)
        try:
            await client.ping()
        finally:
            await client.aclose()

    return check


def storage_check(storage: Storage) -> Check:
    async def check() -> None:
        await asyncio.to_thread(storage.check)

    return check


async def run_checks(checks: Mapping[str, Check], timeout_s: float) -> list[CheckResult]:
    async def one(name: str, check: Check) -> CheckResult:
        try:
            await asyncio.wait_for(check(), timeout=timeout_s)
        except Exception as exc:  # 只回報類型，不回報可能含連線字串的訊息
            log.warning("readiness_check_failed", check=name, error=type(exc).__name__)
            return CheckResult(name, ok=False, error=type(exc).__name__)
        return CheckResult(name, ok=True)

    return list(await asyncio.gather(*(one(n, c) for n, c in checks.items())))
