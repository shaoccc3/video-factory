"""/readyz 的依賴檢查：PostgreSQL、Valkey、對象存儲、字幕字體、FFmpeg；worker 啟動時的環境自檢。"""

import asyncio
import shutil
import tempfile
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from pathlib import Path

import redis.asyncio as redis
import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.core.settings import Settings
from app.core.storage import Storage

Check = Callable[[], Awaitable[None]]
log = structlog.get_logger(__name__)


@dataclass(frozen=True)
class CheckResult:
    name: str
    ok: bool
    error: str | None = None


def database_check(engine: AsyncEngine) -> Check:
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


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def fonts_check(font_file: Path) -> Check:
    """合成字幕要用的字體；缺少時成片會在最後一步才失敗。"""

    async def check() -> None:
        if not font_file.is_file():
            raise FileNotFoundError("font")

    return check


def ffmpeg_check() -> Check:
    """上傳素材（縮圖、探測）與合成都要 ffmpeg／ffprobe。"""

    async def check() -> None:
        if not ffmpeg_available():
            raise FileNotFoundError("ffmpeg")

    return check


def ensure_writable_dir(path: Path) -> None:
    """建立目錄並試寫一個臨時文件；不可寫（如命名卷的擁有者是 root）時拋 OSError。"""
    path.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path, prefix=".probe-"):
        pass


def worker_preflight(settings: Settings) -> None:
    """worker 啟動自檢。

    臨時目錄不可寫時每個生成步驟都會失敗，直接拋 SystemExit 讓 worker 啟動失敗、在日誌裡看到原因；
    缺字體或 ffmpeg 只記錯誤日誌（寫腳本仍可用），/readyz 也會報告。
    """
    try:
        ensure_writable_dir(settings.work_dir)
    except OSError as exc:
        log.error("worker_work_dir_not_writable", path=str(settings.work_dir), error=type(exc).__name__)
        raise SystemExit(f"worker 臨時目錄不可寫：{settings.work_dir}（處理方式見 docs/runbook.md）") from exc
    font_file = settings.fonts_dir / settings.font_file
    if not font_file.is_file():
        log.error("worker_font_missing", path=str(font_file))
    if not ffmpeg_available():
        log.error("worker_ffmpeg_missing")


async def run_checks(checks: Mapping[str, Check], timeout_s: float) -> list[CheckResult]:
    async def one(name: str, check: Check) -> CheckResult:
        try:
            await asyncio.wait_for(check(), timeout=timeout_s)
        except Exception as exc:  # 只回報類型，不回報可能含連線字串的訊息
            log.warning("readiness_check_failed", check=name, error=type(exc).__name__)
            return CheckResult(name, ok=False, error=type(exc).__name__)
        return CheckResult(name, ok=True)

    return list(await asyncio.gather(*(one(n, c) for n, c in checks.items())))
