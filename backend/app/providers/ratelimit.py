"""按模型的限速：每分鐘請求數（rpm）與並發上限（concurrency）。

- MemoryRateLimiter：單進程（測試、單 worker）
- RedisRateLimiter：跨 worker 進程共用（Valkey），用於 compose 部署
"""

import asyncio
import time
import uuid
from collections import deque
from collections.abc import AsyncIterator
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass
from typing import Protocol

import redis.asyncio as redis


@dataclass(frozen=True)
class Limit:
    rpm: int | None
    concurrency: int | None


class RateLimiter(Protocol):
    def slot(self, key: str, limit: Limit) -> AbstractAsyncContextManager[None]: ...


class MemoryRateLimiter:
    def __init__(self) -> None:
        self._sems: dict[str, asyncio.Semaphore] = {}
        self._hits: dict[str, deque[float]] = {}
        self._lock = asyncio.Lock()

    @asynccontextmanager
    async def _slot(self, key: str, limit: Limit) -> AsyncIterator[None]:
        sem = self._sems.setdefault(key, asyncio.Semaphore(limit.concurrency or 1_000_000))
        async with sem:
            if limit.rpm:
                await self._wait_rpm(key, limit.rpm)
            yield

    async def _wait_rpm(self, key: str, rpm: int) -> None:
        while True:
            async with self._lock:
                now = time.monotonic()
                hits = self._hits.setdefault(key, deque())
                while hits and now - hits[0] >= 60:
                    hits.popleft()
                if len(hits) < rpm:
                    hits.append(now)
                    return
                wait = 60 - (now - hits[0])
            await asyncio.sleep(max(wait, 0.05))

    def slot(self, key: str, limit: Limit) -> AbstractAsyncContextManager[None]:
        return self._slot(key, limit)


class RedisRateLimiter:
    """用有序集合記錄持有中的並發槽（帶過期，防 worker 崩潰後洩漏），用分鐘計數器限 rpm。"""

    def __init__(self, url: str, *, slot_ttl_s: int = 3600, poll_s: float = 1.0) -> None:
        self._client = redis.from_url(url)
        self._ttl = slot_ttl_s
        self._poll = poll_s

    @asynccontextmanager
    async def _slot(self, key: str, limit: Limit) -> AsyncIterator[None]:
        token = uuid.uuid4().hex
        conc_key = f"vf:conc:{key}"
        if limit.concurrency:
            while True:
                now = time.time()
                await self._client.zremrangebyscore(conc_key, 0, now - self._ttl)
                await self._client.zadd(conc_key, {token: now})
                rank = await self._client.zrank(conc_key, token)
                if isinstance(rank, int) and rank < limit.concurrency:
                    break
                await self._client.zrem(conc_key, token)
                await asyncio.sleep(self._poll)
        try:
            if limit.rpm:
                while True:
                    minute = int(time.time() // 60)
                    rpm_key = f"vf:rpm:{key}:{minute}"
                    count = await self._client.incr(rpm_key)
                    await self._client.expire(rpm_key, 120)
                    if count <= limit.rpm:
                        break
                    await asyncio.sleep(60 - time.time() % 60 + 0.05)
            yield
        finally:
            if limit.concurrency:
                await self._client.zrem(conc_key, token)

    def slot(self, key: str, limit: Limit) -> AbstractAsyncContextManager[None]:
        return self._slot(key, limit)
