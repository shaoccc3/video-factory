"""P4：模型網關、Provider、重試、預算、限速、下載白名單。外部調用全部 mock。"""

import asyncio
import json
from pathlib import Path

import httpx
import pytest
from pydantic import BaseModel
from sqlalchemy import select

from app.media.ffmpeg import probe
from app.models import CostLedger, GenerationCall, Job, User
from app.models.enums import ErrorKind
from app.providers.ark import ArkHttp
from app.providers.base import ChatMessage, VideoImageInput, VideoRequest
from app.providers.downloader import download, host_allowed
from app.providers.errors import BudgetExceededError, ProviderError, classify_code, with_retries
from app.providers.gateway import CallContext, Gateway, JobCancelledError
from app.providers.live import ArkLLM, ArkSeedance, parse_task, task_error
from app.providers.mock import MockLLM, MockSeedance, moderation_error
from app.providers.pricing import video_tokens
from app.providers.ratelimit import Limit, MemoryRateLimiter
from app.services.runtime import Runtime

pytestmark = pytest.mark.anyio


class Echo(BaseModel):
    answer: str


def _request(**kw: object) -> VideoRequest:
    base: dict[str, object] = {
        "model_id": "seedance-test",
        "prompt": "清晨的茶園",
        "ratio": "9:16",
        "resolution": "480p",
        "duration_s": 2,
        "seed": 42,
        "safety_identifier": "user-1",
    }
    base.update(kw)
    return VideoRequest(**base)  # type: ignore[arg-type]


async def _calls(runtime: Runtime) -> list[GenerationCall]:
    async with runtime.sessionmaker() as s:
        return list((await s.scalars(select(GenerationCall))).all())


async def _ledger(runtime: Runtime) -> list[CostLedger]:
    async with runtime.sessionmaker() as s:
        return list((await s.scalars(select(CostLedger))).all())


# ---- 參數組裝與解析 ---------------------------------------------------------


def test_video_request_payload() -> None:
    req = _request(
        images=(VideoImageInput("https://x.volces.com/a.png", "first_frame"),),
        generate_audio=True,
        draft=True,
    )
    payload = req.to_payload()
    assert payload["model"] == "seedance-test"
    assert payload["content"] == [
        {"type": "text", "text": "清晨的茶園"},
        {"type": "image_url", "image_url": {"url": "https://x.volces.com/a.png"}, "role": "first_frame"},
    ]
    assert payload["ratio"] == "9:16"
    assert payload["duration"] == 2
    assert payload["return_last_frame"] is True
    assert payload["draft"] is True
    assert payload["safety_identifier"] == "user-1"
    assert "camera_fixed" not in payload


def test_parse_task_expired_is_timeout() -> None:
    task = parse_task({"id": "cgt-1", "status": "expired"})
    assert task.status == "failed" and task.error_code == "TaskExpired"
    assert task_error(task).kind is ErrorKind.TIMEOUT


def test_video_request_payload_optional_seed_and_adaptive_ratio() -> None:
    payload = _request(seed=None, adaptive_ratio=True).to_payload()
    assert "seed" not in payload and payload["ratio"] == "adaptive"
    assert _request().to_payload()["seed"] == 42 and _request().to_payload()["ratio"] == "9:16"


def test_parse_task_success_and_failure() -> None:
    ok = parse_task(
        {
            "id": "t1",
            "status": "succeeded",
            "content": {
                "video_url": "https://a.volces.com/v.mp4",
                "last_frame_url": "https://a.volces.com/l.png",
            },
            "usage": {"completion_tokens": 1234},
            "seed": 7,
        }
    )
    assert ok.status == "succeeded" and ok.completion_tokens == 1234 and ok.meta["seed"] == 7
    bad = parse_task(
        {
            "id": "t2",
            "status": "failed",
            "error": {"code": "OutputVideoSensitiveContentDetected", "message": "x"},
        }
    )
    assert bad.error_code == "OutputVideoSensitiveContentDetected"


@pytest.mark.parametrize(
    ("code", "kind"),
    [
        ("InputTextSensitiveContentDetected", ErrorKind.MODERATION),
        ("RateLimitExceeded.EndpointRPMExceeded", ErrorKind.RATE_LIMIT),
        ("ServerOverloaded", ErrorKind.RATE_LIMIT),
        ("InternalServiceError", ErrorKind.SERVER),
        ("RequestTimeout", ErrorKind.TIMEOUT),
        ("InvalidParameter", ErrorKind.CLIENT),
        (None, ErrorKind.CLIENT),
    ],
)
def test_classify_code(code: str | None, kind: ErrorKind) -> None:
    assert classify_code(code) is kind


def test_video_tokens_formula() -> None:
    assert video_tokens(1280, 720, 24, 5) == 1280 * 720 * 24 * 5 // 1024


# ---- 重試判斷 ---------------------------------------------------------------


async def test_retry_only_retryable() -> None:
    calls = 0

    async def flaky() -> str:
        nonlocal calls
        calls += 1
        if calls < 3:
            raise ProviderError(ErrorKind.RATE_LIMIT, "429")
        return "ok"

    async def no_sleep(_: float) -> None:
        return None

    assert await with_retries(flaky, attempts=4, base_s=0.001, what="t", sleep=no_sleep) == "ok"
    assert calls == 3

    calls = 0

    async def moderated() -> str:
        nonlocal calls
        calls += 1
        raise moderation_error()

    with pytest.raises(ProviderError) as info:
        await with_retries(moderated, attempts=4, base_s=0.001, what="t", sleep=no_sleep)
    assert info.value.kind is ErrorKind.MODERATION
    assert calls == 1


# ---- HTTP 客戶端（方舟）-----------------------------------------------------


def _transport(handler: object) -> httpx.MockTransport:
    return httpx.MockTransport(handler)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("status", "body", "kind"),
    [
        (429, {"error": {"code": "RateLimitExceeded", "message": "slow down"}}, ErrorKind.RATE_LIMIT),
        (
            400,
            {"error": {"code": "InputTextSensitiveContentDetected", "message": "no"}},
            ErrorKind.MODERATION,
        ),
        (400, {"error": {"code": "InvalidParameter", "message": "bad"}}, ErrorKind.CLIENT),
        (500, {"error": {"code": "InternalServiceError", "message": "oops"}}, ErrorKind.SERVER),
        (503, {}, ErrorKind.SERVER),
    ],
)
async def test_ark_http_error_mapping(status: int, body: dict[str, object], kind: ErrorKind) -> None:
    http = ArkHttp(
        "https://ark.test/api/v3", "k", transport=_transport(lambda r: httpx.Response(status, json=body))
    )
    with pytest.raises(ProviderError) as info:
        await http.request("GET", "/contents/generations/tasks")
    assert info.value.kind is kind


async def test_ark_http_sends_bearer_and_strips_placeholder() -> None:
    seen: list[str | None] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req.headers.get("authorization"))
        return httpx.Response(200, json={"id": "t"})

    await ArkHttp("https://ark.test", "real-key", transport=_transport(handler)).request("GET", "/x")
    await ArkHttp(
        "https://ark.test", "injected-by-proxy", strip_auth_header=True, transport=_transport(handler)
    ).request("GET", "/x")
    assert seen == ["Bearer real-key", None]


async def test_ark_seedance_paths() -> None:
    seen: list[tuple[str, str]] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append((req.method, req.url.path))
        if req.method == "POST":
            body = json.loads(req.content)
            assert body["content"][0]["type"] == "text"
            return httpx.Response(200, json={"id": "cgt-1"})
        if req.method == "DELETE":
            return httpx.Response(200, json={})
        return httpx.Response(200, json={"id": "cgt-1", "status": "running"})

    sd = ArkSeedance(
        ArkHttp("https://ark.test/api/v3", "k", transport=_transport(handler)), allowed_hosts=(), max_bytes=1
    )
    assert await sd.create(_request()) == "cgt-1"
    assert (await sd.get("cgt-1")).status == "running"
    await sd.cancel("cgt-1")
    assert seen == [
        ("POST", "/api/v3/contents/generations/tasks"),
        ("GET", "/api/v3/contents/generations/tasks/cgt-1"),
        ("DELETE", "/api/v3/contents/generations/tasks/cgt-1"),
    ]


async def test_ark_llm_repairs_invalid_json() -> None:
    replies = iter(['{"wrong": 1}', '```json\n{"answer": "好"}\n```'])
    bodies: list[dict[str, object]] = []

    def handler(req: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(req.content))
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": next(replies)}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5},
            },
        )

    llm = ArkLLM(ArkHttp("https://ark.test", "k", transport=_transport(handler)))
    result = await llm.chat_json("m", [ChatMessage("user", "hi")], Echo)
    assert result.value.answer == "好"
    assert result.attempts == 2
    assert result.usage.total_tokens == 30
    assert len(bodies[1]["messages"]) == 3  # type: ignore[arg-type]


async def test_ark_llm_gives_up_after_two_repairs() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": [{"message": {"content": "not json"}}], "usage": {}})

    llm = ArkLLM(ArkHttp("https://ark.test", "k", transport=_transport(handler)))
    with pytest.raises(ProviderError, match="校驗"):
        await llm.chat_json("m", [ChatMessage("user", "hi")], Echo)


# ---- 下載白名單 -------------------------------------------------------------


def test_host_allowlist() -> None:
    allowed = ("*.volces.com", "cdn.example.com")
    assert host_allowed("https://ark-content.tos-cn-beijing.volces.com/v.mp4?sig=1", allowed)
    assert host_allowed("https://cdn.example.com/a", allowed)
    assert not host_allowed("http://x.volces.com/a", allowed)  # 非 https
    assert not host_allowed("https://volces.com.evil.io/a", allowed)
    assert not host_allowed("https://169.254.169.254/latest", allowed)
    assert not host_allowed("file:///etc/passwd", allowed)


async def test_download_size_limit(tmp_path: Path) -> None:
    client = httpx.AsyncClient(transport=_transport(lambda r: httpx.Response(200, content=b"x" * 2048)))
    with pytest.raises(ProviderError, match="大小上限"):
        await download(
            client,
            "https://a.volces.com/v.mp4",
            tmp_path / "v.mp4",
            allowed_hosts=("*.volces.com",),
            max_bytes=1024,
        )
    assert not (tmp_path / "v.mp4").exists()
    with pytest.raises(ProviderError, match="白名單"):
        await download(
            client,
            "https://evil.io/v.mp4",
            tmp_path / "v.mp4",
            allowed_hosts=("*.volces.com",),
            max_bytes=1024,
        )
    ok = await download(
        client,
        "https://a.volces.com/v.mp4",
        tmp_path / "ok.mp4",
        allowed_hosts=("*.volces.com",),
        max_bytes=4096,
    )
    assert ok.stat().st_size == 2048


# ---- 限速 -------------------------------------------------------------------


async def test_memory_limiter_concurrency() -> None:
    limiter = MemoryRateLimiter()
    active = peak = 0

    async def work() -> None:
        nonlocal active, peak
        async with limiter.slot("video_final", Limit(rpm=None, concurrency=2)):
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.01)
            active -= 1

    await asyncio.gather(*(work() for _ in range(6)))
    assert peak == 2


# ---- 網關：記帳、預算、輪詢 -------------------------------------------------


async def _job(runtime: Runtime, user: User, budget: float = 50) -> Job:
    async with runtime.sessionmaker() as s:
        from app.models import Template

        tpl = Template(
            key="t",
            name="t",
            video_type="marketing",
            ratio="9:16",
            resolution="480p",
            min_duration_s=5,
            max_duration_s=30,
            min_shots=1,
            max_shots=6,
            audio_mode="none",
        )
        s.add(tpl)
        await s.flush()
        job = Job(
            owner_id=user.id,
            template_id=tpl.id,
            template_snapshot={},
            title="t",
            video_type="marketing",
            inputs={},
            options={},
            status="generating",
            region="byteplus",
            ratio="9:16",
            resolution="480p",
            seed=1,
            budget_cny=budget,
            actual_cost_cny=0,
        )
        s.add(job)
        await s.commit()
        return job


async def test_chat_json_records_call_and_cost(runtime: Runtime, gateway: Gateway, user: User) -> None:
    job = await _job(runtime, user)
    llm = runtime.providers.llm
    assert isinstance(llm, MockLLM)
    llm.scripted.append({"answer": "好"})
    llm.failures.errors.append(ProviderError(ErrorKind.RATE_LIMIT, "429"))
    llm.failures.errors.append(ProviderError(ErrorKind.SERVER, "500"))
    out = await gateway.chat_json(CallContext(job.id, user.id), [ChatMessage("user", "hi")], Echo)
    assert out.answer == "好"
    [call] = await _calls(runtime)
    assert call.status == "succeeded" and call.provider == "llm"
    [entry] = await _ledger(runtime)
    assert entry.amount_cny > 0 and entry.currency == "USD"
    assert entry.usage["price_per_mtok_input"] == 0.25 and entry.usage["price_per_mtok_output"] == 2.0
    prompt, completion = entry.usage["prompt_tokens"], entry.usage["completion_tokens"]
    assert isinstance(prompt, int) and isinstance(completion, int)
    assert float(entry.unit_price) == pytest.approx(
        (prompt * 0.25 + completion * 2.0) / (prompt + completion), rel=1e-3
    )
    async with runtime.sessionmaker() as s:
        refreshed = await s.get(Job, job.id)
        assert refreshed is not None and refreshed.actual_cost_cny == pytest.approx(entry.amount_cny)


async def test_run_video_polls_downloads_and_bills(
    runtime: Runtime, gateway: Gateway, user: User, tmp_path: Path
) -> None:
    job = await _job(runtime, user)
    sd = runtime.providers.seedance
    assert isinstance(sd, MockSeedance)
    sd.running_polls = 2
    created: list[str] = []

    async def on_created(task_id: str) -> None:
        created.append(task_id)

    run = await gateway.run_video(
        CallContext(job.id, user.id), "video_final", _request(), dest_dir=tmp_path, on_created=on_created
    )
    assert created and created[0].startswith("mock-")
    info = await probe(run.outputs.video)
    assert info.duration_s == pytest.approx(2, abs=0.2)
    assert run.outputs.last_frame is not None and run.outputs.last_frame.exists()
    assert sd.created[0].safety_identifier == "user-1"
    [entry] = await _ledger(runtime)
    assert entry.usage["completion_tokens"] == video_tokens(
        480, 854, 24, 2
    )  # 測試用模型 ID 不在能力表，按短邊推算
    assert float(entry.unit_price) == pytest.approx(7.0)
    [call] = await _calls(runtime)
    assert call.remote_task_id == created[0]


async def test_run_video_moderation_failure(
    runtime: Runtime, gateway: Gateway, user: User, tmp_path: Path
) -> None:
    job = await _job(runtime, user)
    sd = runtime.providers.seedance
    assert isinstance(sd, MockSeedance)
    sd.task_failures[1] = ("OutputVideoSensitiveContentDetected", "輸出不合規")
    with pytest.raises(ProviderError) as info:
        await gateway.run_video(CallContext(job.id, user.id), "video_final", _request(), dest_dir=tmp_path)
    assert info.value.kind is ErrorKind.MODERATION
    [call] = await _calls(runtime)
    assert call.status == "failed" and call.error_kind == "moderation"
    assert await _ledger(runtime) == []


async def test_run_video_timeout_cancels_remote(
    runtime: Runtime, gateway: Gateway, user: User, tmp_path: Path
) -> None:
    job = await _job(runtime, user)
    sd = runtime.providers.seedance
    assert isinstance(sd, MockSeedance)
    sd.running_polls = 10_000
    gateway.settings = gateway.settings.model_copy(
        update={"seedance_total_timeout_s": 0.01, "seedance_poll_initial_s": 0.02}
    )
    with pytest.raises(ProviderError) as info:
        await gateway.run_video(CallContext(job.id, user.id), "video_final", _request(), dest_dir=tmp_path)
    assert info.value.code == "poll_timeout"
    assert len(sd.cancelled) == 1


async def test_run_video_cancelled_job(
    runtime: Runtime, gateway: Gateway, user: User, tmp_path: Path
) -> None:
    job = await _job(runtime, user)
    sd = runtime.providers.seedance
    assert isinstance(sd, MockSeedance)
    sd.running_polls = 5

    async def cancelled() -> bool:
        return True

    with pytest.raises(JobCancelledError):
        await gateway.run_video(
            CallContext(job.id, user.id, is_cancelled=cancelled), "video_final", _request(), dest_dir=tmp_path
        )
    assert len(sd.cancelled) == 1


async def test_run_video_resumes_existing_task(
    runtime: Runtime, gateway: Gateway, user: User, tmp_path: Path
) -> None:
    job = await _job(runtime, user)
    sd = runtime.providers.seedance
    assert isinstance(sd, MockSeedance)
    task_id = await sd.create(_request())
    sd.created.clear()
    await gateway.run_video(
        CallContext(job.id, user.id), "video_final", _request(), dest_dir=tmp_path, existing_task_id=task_id
    )
    assert sd.created == []


async def test_budget_exceeded_blocks_call(
    runtime: Runtime, gateway: Gateway, user: User, tmp_path: Path
) -> None:
    job = await _job(runtime, user, budget=0.0001)
    with pytest.raises(BudgetExceededError) as info:
        await gateway.run_video(CallContext(job.id, user.id), "video_final", _request(), dest_dir=tmp_path)
    assert info.value.scope == "job"
    assert await _calls(runtime) == []


async def test_daily_budget(runtime: Runtime, gateway: Gateway, tmp_path: Path) -> None:
    from tests.conftest import make_user

    poor = await make_user(runtime, daily_budget_cny=0.0001)
    job = await _job(runtime, poor, budget=100)
    with pytest.raises(BudgetExceededError) as info:
        await gateway.run_video(CallContext(job.id, poor.id), "video_final", _request(), dest_dir=tmp_path)
    assert info.value.scope == "daily"


async def test_download_failure_is_retried(
    runtime: Runtime, gateway: Gateway, user: User, tmp_path: Path
) -> None:
    job = await _job(runtime, user)
    sd = runtime.providers.seedance
    assert isinstance(sd, MockSeedance)
    original = sd.fetch_outputs
    attempts = 0

    async def flaky_fetch(task, dest_dir):  # type: ignore[no-untyped-def]
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise ProviderError(ErrorKind.SERVER, "下載連線失敗")
        return await original(task, dest_dir)

    sd.fetch_outputs = flaky_fetch  # type: ignore[method-assign]
    run = await gateway.run_video(CallContext(job.id, user.id), "video_final", _request(), dest_dir=tmp_path)
    assert attempts == 2 and run.outputs.video.exists()
