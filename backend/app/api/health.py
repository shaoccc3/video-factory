"""健康檢查：/healthz 只回存活；/readyz 檢查依賴。"""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.core.readiness import Check, run_checks

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz")
async def readyz(request: Request) -> JSONResponse:
    checks: dict[str, Check] = request.app.state.readiness_checks
    timeout_s: float = request.app.state.settings.readiness_timeout_s
    results = await run_checks(checks, timeout_s)
    ok = all(r.ok for r in results)
    body = {
        "status": "ok" if ok else "unavailable",
        "checks": {r.name: {"ok": r.ok, "error": r.error} for r in results},
    }
    return JSONResponse(body, status_code=200 if ok else 503)
