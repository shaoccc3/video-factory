"""部署前置條件：/readyz 的字體與 ffmpeg 檢查、worker 啟動自檢、compose 轉發的空變量。"""

import shutil
from pathlib import Path

import httpx
import pytest
from celery.signals import worker_init
from pydantic import ValidationError

from app.core import readiness
from app.core.readiness import (
    ensure_writable_dir,
    ffmpeg_check,
    fonts_check,
    run_checks,
    worker_preflight,
)
from app.core.settings import Settings
from app.main import create_app
from app.services.runtime import Runtime
from tests.helpers import InlineDispatcher

pytestmark = pytest.mark.anyio


class _Log:
    """替換模組 logger：structlog 首次使用後會快取，capture_logs 在整套測試裡不可靠。"""

    def __init__(self) -> None:
        self.events: list[tuple[str, str]] = []

    def error(self, event: str, **_: object) -> None:
        self.events.append(("error", event))

    def warning(self, event: str, **_: object) -> None:
        self.events.append(("warning", event))


@pytest.fixture
def logs(monkeypatch: pytest.MonkeyPatch) -> _Log:
    fake = _Log()
    monkeypatch.setattr(readiness, "log", fake)
    return fake


def _no_ffmpeg(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(shutil, "which", lambda _name: None)


async def test_fonts_check(tmp_path: Path) -> None:
    font = tmp_path / "font.otf"
    [missing] = await run_checks({"fonts": fonts_check(font)}, timeout_s=1)
    assert missing.ok is False
    assert missing.error == "FileNotFoundError"

    font.write_bytes(b"otf")
    [present] = await run_checks({"fonts": fonts_check(font)}, timeout_s=1)
    assert present.ok is True


async def test_ffmpeg_check(monkeypatch: pytest.MonkeyPatch) -> None:
    _no_ffmpeg(monkeypatch)
    [result] = await run_checks({"ffmpeg": ffmpeg_check()}, timeout_s=1)
    assert result.ok is False


async def test_readyz_reports_missing_fonts(
    settings: Settings, runtime: Runtime, dispatcher: InlineDispatcher, tmp_path: Path
) -> None:
    app = create_app(
        settings.model_copy(update={"fonts_dir": tmp_path / "no-fonts"}),
        runtime=runtime,
        dispatcher=dispatcher,
    )
    assert {"database", "storage", "fonts", "ffmpeg"} <= set(app.state.readiness_checks)
    checks = app.state.readiness_checks
    app.state.readiness_checks = {"database": checks["database"], "fonts": checks["fonts"]}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/readyz")
    assert resp.status_code == 503
    body = resp.json()
    assert body["checks"]["fonts"] == {"ok": False, "error": "FileNotFoundError"}
    assert body["checks"]["database"]["ok"] is True
    assert "no-fonts" not in resp.text


def test_ensure_writable_dir_creates_and_leaves_nothing(tmp_path: Path) -> None:
    work = tmp_path / "a" / "work"
    ensure_writable_dir(work)
    assert work.is_dir()
    assert list(work.iterdir()) == []


def test_worker_preflight_exits_when_work_dir_not_writable(
    settings: Settings, tmp_path: Path, logs: _Log
) -> None:
    blocker = tmp_path / "file"
    blocker.write_text("")
    with pytest.raises(SystemExit, match="臨時目錄不可寫"):
        worker_preflight(settings.model_copy(update={"work_dir": blocker / "work"}))
    assert logs.events == [("error", "worker_work_dir_not_writable")]


def test_worker_preflight_only_logs_missing_fonts_and_ffmpeg(
    settings: Settings, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, logs: _Log
) -> None:
    _no_ffmpeg(monkeypatch)
    worker_preflight(settings.model_copy(update={"fonts_dir": tmp_path / "no-fonts"}))
    assert logs.events == [("error", "worker_font_missing"), ("error", "worker_ffmpeg_missing")]
    assert settings.work_dir.is_dir()


def test_worker_preflight_quiet_when_ready(
    settings: Settings, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, logs: _Log
) -> None:
    (tmp_path / "fonts").mkdir()
    (tmp_path / "fonts" / settings.font_file).write_bytes(b"otf")
    monkeypatch.setattr(shutil, "which", lambda name: f"/usr/bin/{name}")
    worker_preflight(settings.model_copy(update={"fonts_dir": tmp_path / "fonts"}))
    assert logs.events == []


def test_worker_init_signal_runs_preflight(
    settings: Settings, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, logs: _Log
) -> None:
    # celery 的 Signal.send 會吞掉 Exception；SystemExit 必須穿透才能讓 worker 啟動失敗
    import app.workers as workers

    blocker = tmp_path / "file"
    blocker.write_text("")
    monkeypatch.setattr(workers, "_settings", settings.model_copy(update={"work_dir": blocker / "work"}))
    with pytest.raises(SystemExit):
        worker_init.send(sender=None)
    assert logs.events == [("error", "worker_work_dir_not_writable")]


@pytest.fixture
def clean_env(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    """Settings() 只讀測試設定的變量，不受本機或 CI 環境影響。"""
    for name in Settings.model_fields:
        monkeypatch.delenv(name.upper(), raising=False)
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


def test_empty_env_falls_back_to_defaults(clean_env: pytest.MonkeyPatch) -> None:
    # compose 用 ${VAR:-} 轉發選填變量，沒填時容器裡是空字串
    for name in (
        "DOWNLOAD_ALLOWED_HOSTS",
        "DOWNLOAD_MAX_BYTES",
        "SEEDANCE_TOTAL_TIMEOUT_S",
        "PRESIGN_EXPIRES_S",
        "S3_PUBLIC_ENDPOINT_URL",
    ):
        clean_env.setenv(name, "")
    defaults = Settings.model_fields
    s = Settings()
    assert s.download_allowed_hosts == defaults["download_allowed_hosts"].default
    assert s.download_max_bytes == defaults["download_max_bytes"].default
    assert s.seedance_total_timeout_s == defaults["seedance_total_timeout_s"].default
    assert s.presign_expires_s == defaults["presign_expires_s"].default
    assert s.s3_public_endpoint_url is None


def test_operational_env_values(clean_env: pytest.MonkeyPatch) -> None:
    clean_env.setenv(
        "DOWNLOAD_ALLOWED_HOSTS",
        '["*.example-cdn.com", "files.example.com", "*.tos-ap-southeast-1.bytepluses.com", "P16-Sign.ByteImg.com"]',
    )
    clean_env.setenv("DOWNLOAD_MAX_BYTES", "1048576")
    clean_env.setenv("SEEDANCE_TOTAL_TIMEOUT_S", "3600")
    clean_env.setenv("PRESIGN_EXPIRES_S", "43200")
    s = Settings()
    assert s.download_allowed_hosts == (
        "*.example-cdn.com",
        "files.example.com",
        "*.tos-ap-southeast-1.bytepluses.com",
        "P16-Sign.ByteImg.com",
    )
    assert (s.download_max_bytes, s.seedance_total_timeout_s, s.presign_expires_s) == (1048576, 3600, 43200)


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("DOWNLOAD_ALLOWED_HOSTS", "[]"),
        ("DOWNLOAD_ALLOWED_HOSTS", '["*"]'),
        ("DOWNLOAD_ALLOWED_HOSTS", '["*.com"]'),
        ("DOWNLOAD_ALLOWED_HOSTS", '["*.volces.com", "169.254.169.254"]'),
        ("DOWNLOAD_ALLOWED_HOSTS", '["localhost"]'),
        ("DOWNLOAD_ALLOWED_HOSTS", '["*bytepluses.com"]'),
        ("DOWNLOAD_ALLOWED_HOSTS", '["foo.localhost"]'),
        ("DOWNLOAD_ALLOWED_HOSTS", '["metadata.google.internal"]'),
        ("DOWNLOAD_ALLOWED_HOSTS", '["169.254.169.254.nip.io"]'),
        ("DOWNLOAD_ALLOWED_HOSTS", '["*.co.uk"]'),
        ("DOWNLOAD_ALLOWED_HOSTS", '["*.s3.amazonaws.com"]'),
        ("DOWNLOAD_MAX_BYTES", "0"),
        ("SEEDANCE_TOTAL_TIMEOUT_S", "-1"),
        ("PRESIGN_EXPIRES_S", "0"),
        ("PRESIGN_EXPIRES_S", str(8 * 24 * 3600)),
    ],
)
def test_invalid_operational_env_fails_at_startup(
    clean_env: pytest.MonkeyPatch, name: str, value: str
) -> None:
    clean_env.setenv(name, value)
    with pytest.raises(ValidationError):
        Settings()
