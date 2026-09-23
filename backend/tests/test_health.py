import httpx
import pytest
from fastapi import FastAPI

from app.core.settings import Settings

pytestmark = pytest.mark.anyio


async def _ok() -> None:
    return None


async def _fail() -> None:
    raise ConnectionError("secret-host:5432")


async def test_healthz(client: httpx.AsyncClient) -> None:
    resp = await client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


async def test_request_id_generated_and_echoed(client: httpx.AsyncClient) -> None:
    resp = await client.get("/healthz")
    assert len(resp.headers["x-request-id"]) == 32

    resp = await client.get("/healthz", headers={"X-Request-ID": "abc-123"})
    assert resp.headers["x-request-id"] == "abc-123"


async def test_invalid_request_id_replaced(client: httpx.AsyncClient) -> None:
    resp = await client.get("/healthz", headers={"X-Request-ID": "bad id\n"})
    assert resp.headers["x-request-id"] != "bad id\n"


async def test_readyz_all_ok(app: FastAPI, client: httpx.AsyncClient) -> None:
    app.state.readiness_checks = {"database": _ok, "valkey": _ok, "storage": _ok}
    resp = await client.get("/readyz")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


async def test_readyz_reports_failure_without_details(app: FastAPI, client: httpx.AsyncClient) -> None:
    app.state.readiness_checks = {"database": _ok, "valkey": _fail, "storage": _ok}
    resp = await client.get("/readyz")
    assert resp.status_code == 503
    body = resp.json()
    assert body["checks"]["valkey"] == {"ok": False, "error": "ConnectionError"}
    assert body["checks"]["database"]["ok"] is True
    assert "secret-host" not in resp.text


async def test_readyz_real_postgres_check_on_sqlite(app: FastAPI, client: httpx.AsyncClient) -> None:
    checks = app.state.readiness_checks
    app.state.readiness_checks = {"database": checks["database"]}
    resp = await client.get("/readyz")
    assert resp.status_code == 200


async def test_readyz_unreachable_valkey(client: httpx.AsyncClient) -> None:
    resp = await client.get("/readyz")
    assert resp.status_code == 503
    checks = resp.json()["checks"]
    assert checks["valkey"]["ok"] is False
    assert checks["database"]["ok"] is True
    assert checks["storage"]["ok"] is True


async def test_s3_storage_unreachable(settings: Settings) -> None:
    from app.core.readiness import run_checks, storage_check
    from app.core.storage import S3Storage

    s3 = S3Storage(settings.model_copy(update={"s3_endpoint_url": "http://127.0.0.1:1"}))
    [result] = await run_checks({"storage": storage_check(s3)}, timeout_s=5)
    assert result.ok is False
