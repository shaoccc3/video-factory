"""補充覆蓋：CLI、Seedream／TTS 真實接口的請求組裝（MockTransport）、模板建立。"""

import base64
import json
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select

from app.cli import cmd_create_user, cmd_sync_templates
from app.core.security import verify_password
from app.core.settings import Settings
from app.media.samples import make_test_audio
from app.models import Base, Template, User
from app.models.enums import ErrorKind
from app.providers.ark import ArkHttp
from app.providers.errors import ProviderError
from app.providers.live import ArkSeedream, DoubaoTTS
from app.providers.registry import ProviderConfigError, build_providers
from app.services.runtime import Runtime, build_runtime

pytestmark = pytest.mark.anyio

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


async def test_cli_sync_templates_and_create_user(settings: Settings) -> None:
    rt = build_runtime(settings)
    async with rt.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await rt.aclose()
    await cmd_sync_templates(settings, force=False)
    await cmd_sync_templates(settings, force=True)
    await cmd_create_user(settings, "Boss@Example.com", "老闆", ["admin"], "secret-pass-1")
    await cmd_create_user(settings, "boss@example.com", "老闆", ["admin", "reviewer"], "secret-pass-2")
    rt = build_runtime(settings)
    async with rt.sessionmaker() as s:
        keys = {t.key: t.version for t in (await s.scalars(select(Template))).all()}
        users = (await s.scalars(select(User))).all()
    await rt.aclose()
    assert keys == {"marketing": 2, "quick": 2, "training": 2}
    [boss] = users
    assert boss.email == "boss@example.com" and boss.roles == ["admin", "reviewer"]
    assert verify_password(boss.password_hash, "secret-pass-2")


async def test_seedream_b64_and_url(tmp_path: Path) -> None:
    bodies: list[dict[str, object]] = []

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path.endswith("/images/generations"):
            bodies.append(json.loads(req.content))
            if len(bodies) == 1:
                return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(PNG).decode()}]})
            return httpx.Response(
                200,
                json={"data": [{"url": "https://img.volces.com/a.png"}], "usage": {"generated_images": 1}},
            )
        return httpx.Response(200, content=PNG)

    http = ArkHttp("https://ark.test/api/v3", "k", transport=httpx.MockTransport(handler))
    sd = ArkSeedream(http, allowed_hosts=("*.volces.com",), max_bytes=10_000, watermark=True)
    r1 = await sd.generate("m", "茶園", size="720x1280", seed=1, ref_image_urls=(), dest=tmp_path / "a.png")
    r2 = await sd.generate(
        "m",
        "茶園",
        size="720x1280",
        seed=1,
        ref_image_urls=("https://x/1.png", "https://x/2.png"),
        dest=tmp_path / "b.png",
    )
    assert r1.path.read_bytes() == PNG and r2.path.read_bytes() == PNG
    assert "image" not in bodies[0] and bodies[1]["image"] == ["https://x/1.png", "https://x/2.png"]
    assert bodies[0]["watermark"] is True and bodies[0]["size"] == "720x1280"


async def test_doubao_tts(tmp_path: Path) -> None:
    audio = (await make_test_audio(tmp_path / "src.mp3", duration_s=1.5)).read_bytes()
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        body = json.loads(req.content)
        if body["request"]["text"] == "違規":
            return httpx.Response(200, json={"code": 3010, "message": "sensitive"})
        return httpx.Response(200, json={"code": 3000, "data": base64.b64encode(audio).decode()})

    tts = DoubaoTTS(
        endpoint="https://tts.test/api/v1/tts",
        app_id="app",
        token="tok",
        cluster="c",
        transport=httpx.MockTransport(handler),
    )
    result = await tts.synthesize("你好 世界", voice="v1", user_id="u1", dest=tmp_path / "out.mp3")
    assert result.chars == 4 and result.duration_s == pytest.approx(1.5, abs=0.2)
    assert seen[0].headers["authorization"] == "Bearer;tok"
    body = json.loads(seen[0].content)
    assert body["audio"]["voice_type"] == "v1" and body["app"]["appid"] == "app"
    with pytest.raises(ProviderError) as info:
        await tts.synthesize("違規", voice="v1", user_id="u1", dest=tmp_path / "x.mp3")
    assert info.value.kind is ErrorKind.MODERATION


async def test_live_mode_requires_key(settings: Settings, runtime: Runtime) -> None:
    live = settings.model_copy(update={"provider_mode": "live", "ark_api_key": None})
    with pytest.raises(ProviderConfigError):
        build_providers(live, runtime.config)
    from pydantic import SecretStr

    ok = build_providers(
        settings.model_copy(update={"provider_mode": "live", "ark_api_key": SecretStr("k")}), runtime.config
    )
    assert ok.mode == "live"


async def test_admin_creates_template(runtime: Runtime, client: httpx.AsyncClient) -> None:
    from tests.conftest import make_user

    admin = await make_user(runtime, roles=("admin",))
    await client.post("/api/v1/auth/login", json={"email": admin.email, "password": "password-123"})
    body = {
        "key": "promo-square",
        "name": "方形促銷",
        "video_type": "marketing",
        "ratio": "1:1",
        "resolution": "720p",
        "min_duration_s": 10,
        "max_duration_s": 20,
        "min_shots": 2,
        "max_shots": 4,
        "audio_mode": "none",
        "subtitle_required": False,
        "prompt_template": "主題：{{ topic }}",
    }
    r = await client.post("/api/v1/templates", json=body)
    assert r.status_code == 201 and r.json()["version"] == 1
    assert (await client.post("/api/v1/templates", json=body)).status_code == 409
    assert (await client.post("/api/v1/templates", json={**body, "key": "Bad Key"})).status_code == 422
