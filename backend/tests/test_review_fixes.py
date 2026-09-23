"""審查後的修正：密鑰不隨下載外洩、safety_identifier、失敗調用照樣記賬、生成素材的越權引用、上傳解碼校驗。"""

import json
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select

from app.core.settings import Settings
from app.main import create_app
from app.models import CostLedger, GenerationCall, Job, Template, User
from app.models.enums import AssetKind, ErrorKind
from app.pipeline.orchestrator import ActionError
from app.providers.ark import ArkHttp, redact_urls
from app.providers.base import ChatMessage, VideoTask
from app.providers.errors import ProviderError
from app.providers.gateway import CallContext, Gateway
from app.providers.live import ArkLLM, ArkSeedance
from app.providers.mock import MockLLM, MockSeedance
from app.services.jobs import JobInput, create_job
from app.services.runtime import Runtime
from tests.conftest import make_user
from tests.helpers import make_asset, setup_templates
from tests.test_providers import Echo, _job, _request

pytestmark = pytest.mark.anyio


async def test_downloads_do_not_carry_api_key(tmp_path: Path) -> None:
    seen: dict[str, str | None] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen[req.url.host] = req.headers.get("authorization")
        if req.url.host == "ark.test":
            return httpx.Response(200, json={})
        return httpx.Response(200, content=b"data")

    http = ArkHttp("https://ark.test/api/v3", "real-key", transport=httpx.MockTransport(handler))
    sd = ArkSeedance(http, allowed_hosts=("*.volces.com",), max_bytes=1000)
    task = VideoTask(
        id="t",
        status="succeeded",
        video_url="https://tos.volces.com/v.mp4?X-Amz-Signature=abc",
        last_frame_url="https://tos.volces.com/l.png",
    )
    await sd.fetch_outputs(task, tmp_path)
    await http.request("GET", "/x")
    assert seen["tos.volces.com"] is None
    assert seen["ark.test"] == "Bearer real-key"


def test_redact_urls() -> None:
    text = "無法下載 https://tos.volces.com/a.png?X-Amz-Signature=secret&x=1 請檢查"
    assert redact_urls(text) == "無法下載 https://tos.volces.com/a.png?… 請檢查"


async def test_llm_sends_user_and_gives_up_without_retry() -> None:
    bodies: list[dict[str, object]] = []

    def handler(req: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(req.content))
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "not json"}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5},
            },
        )

    llm = ArkLLM(ArkHttp("https://ark.test", "k", transport=httpx.MockTransport(handler)))
    with pytest.raises(ProviderError) as info:
        await llm.chat_json("m", [ChatMessage("user", "hi")], Echo, safety_identifier="user-9")
    assert info.value.kind is ErrorKind.CLIENT and not info.value.retryable
    assert info.value.billed_tokens == 45
    assert all(b["user"] == "user-9" for b in bodies)


async def test_failed_llm_call_is_still_billed(runtime: Runtime, gateway: Gateway, user: User) -> None:
    job = await _job(runtime, user)
    llm = runtime.providers.llm
    assert isinstance(llm, MockLLM)
    llm.failures.errors.append(
        ProviderError(ErrorKind.CLIENT, "bad", code="llm_invalid_json", billed_tokens=5000)
    )
    with pytest.raises(ProviderError):
        await gateway.chat_json(CallContext(job.id, user.id), [ChatMessage("user", "hi")], Echo)
    async with runtime.sessionmaker() as s:
        [entry] = (await s.scalars(select(CostLedger))).all()
        [call] = (await s.scalars(select(GenerationCall))).all()
        refreshed = await s.get(Job, job.id)
    assert entry.usage["prompt_tokens"] == 5000 and call.status == "failed"
    assert refreshed is not None and refreshed.actual_cost_cny == pytest.approx(entry.amount_cny)


async def test_seedance_billed_even_if_download_fails(
    runtime: Runtime, gateway: Gateway, user: User, tmp_path: Path
) -> None:
    job = await _job(runtime, user)
    sd = runtime.providers.seedance
    assert isinstance(sd, MockSeedance)

    async def broken(task, dest_dir):  # type: ignore[no-untyped-def]
        raise ProviderError(ErrorKind.CLIENT, "下載地址不在白名單內", code="download_host_denied")

    sd.fetch_outputs = broken  # type: ignore[method-assign]
    with pytest.raises(ProviderError):
        await gateway.run_video(CallContext(job.id, user.id), "video_final", _request(), dest_dir=tmp_path)
    async with runtime.sessionmaker() as s:
        [entry] = (await s.scalars(select(CostLedger))).all()
        [call] = (await s.scalars(select(GenerationCall))).all()
    assert int(str(entry.usage["completion_tokens"])) > 0 and call.status == "failed"

    # 續跑沿用同一個遠端任務：不重複記賬
    sd.fetch_outputs = MockSeedance.fetch_outputs.__get__(sd)  # type: ignore[method-assign]
    assert call.remote_task_id is not None
    await gateway.run_video(
        CallContext(job.id, user.id),
        "video_final",
        _request(),
        dest_dir=tmp_path,
        existing_task_id=call.remote_task_id,
    )
    async with runtime.sessionmaker() as s:
        assert len((await s.scalars(select(CostLedger))).all()) == 1


async def test_safety_identifier_reaches_llm_and_seedream(
    runtime: Runtime, gateway: Gateway, user: User, tmp_path: Path
) -> None:
    job = await _job(runtime, user)
    ctx = CallContext(job.id, user.id)
    llm = runtime.providers.llm
    assert isinstance(llm, MockLLM)
    llm.scripted.append({"answer": "好"})
    await gateway.chat_json(ctx, [ChatMessage("user", "hi")], Echo)
    await gateway.generate_image(
        ctx, prompt="茶", size="320x320", seed=1, ref_image_urls=(), dest=tmp_path / "k.png"
    )
    assert llm.safety_identifiers == [str(user.id)]
    assert runtime.providers.seedream.safety_identifiers == [str(user.id)]  # type: ignore[attr-defined]


async def test_cannot_reference_others_generated_assets(runtime: Runtime, user: User, tmp_path: Path) -> None:
    templates: dict[str, Template] = await setup_templates(runtime)
    other = await make_user(runtime)
    theirs = await make_asset(runtime, other, AssetKind.PRODUCT, tmp_path)
    async with runtime.sessionmaker() as s:
        generated = await s.get(type(theirs), theirs.id)
        assert generated is not None
        generated.source = "generated"
        generated.kind = AssetKind.KEYFRAME.value
        await s.commit()
        me = await s.get(User, user.id)
        assert me is not None
        with pytest.raises(ActionError):
            await create_job(
                s, runtime.config, "byteplus", me,
                JobInput(template_id=templates["quick"].id, title="t", topic="海浪", image_asset_id=theirs.id),
            )  # fmt: skip
        owner = await s.get(User, other.id)
        assert owner is not None
        job = await create_job(
            s, runtime.config, "byteplus", owner,
            JobInput(template_id=templates["quick"].id, title="t", topic="海浪", image_asset_id=theirs.id),
        )  # fmt: skip
        assert job.id


async def test_upload_rejects_undecodable_image(client: httpx.AsyncClient, runtime: Runtime) -> None:
    u = await make_user(runtime)
    await client.post("/api/v1/auth/login", json={"email": u.email, "password": "password-123"})
    fake = b"\x89PNG\r\n\x1a\n" + b"not really a png" * 10
    r = await client.post(
        "/api/v1/assets", data={"kind": "product"}, files={"file": ("x.png", fake, "image/png")}
    )
    assert r.status_code == 422 and "解碼" in r.json()["detail"]


async def test_production_requires_real_secret(settings: Settings, runtime: Runtime) -> None:
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        create_app(settings.model_copy(update={"cookie_secure": True}), runtime=runtime)
