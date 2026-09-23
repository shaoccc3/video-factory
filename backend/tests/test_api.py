"""P11／P12：HTTP 接口、登入、權限、審核、審計、上傳校驗。全部用 MockProvider。"""

import io
import uuid
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select

from app.media.samples import make_test_audio, make_test_image
from app.models import AuditLog, Template, User
from app.services.runtime import Runtime
from tests.conftest import make_user
from tests.helpers import InlineDispatcher, setup_templates

pytestmark = pytest.mark.anyio
PASSWORD = "password-123"


async def login(client: httpx.AsyncClient, user: User) -> None:
    resp = await client.post("/api/v1/auth/login", json={"email": user.email, "password": PASSWORD})
    assert resp.status_code == 200, resp.text


@pytest.fixture
async def templates(runtime: Runtime) -> dict[str, Template]:
    return await setup_templates(runtime)


@pytest.fixture
async def admin(runtime: Runtime) -> User:
    return await make_user(runtime, roles=("admin", "reviewer", "creator"), email="admin@example.com")


@pytest.fixture
async def creator(runtime: Runtime) -> User:
    return await make_user(runtime, roles=("creator",), email="creator@example.com")


async def png_bytes(tmp: Path) -> bytes:
    return (await make_test_image(tmp / "p.png", width=200, height=200)).read_bytes()


# ---- 認證 ---------------------------------------------------------------------


async def test_login_me_logout(client: httpx.AsyncClient, creator: User) -> None:
    assert (await client.get("/api/v1/auth/me")).status_code == 401
    bad = await client.post("/api/v1/auth/login", json={"email": creator.email, "password": "wrong-pass"})
    assert bad.status_code == 401
    await login(client, creator)
    me = await client.get("/api/v1/auth/me")
    assert me.json()["email"] == creator.email and me.json()["roles"] == ["creator"]
    assert "password_hash" not in me.text
    assert (await client.post("/api/v1/auth/logout")).status_code == 204
    client.cookies.clear()
    assert (await client.get("/api/v1/auth/me")).status_code == 401


async def test_session_cookie_is_httponly(client: httpx.AsyncClient, creator: User) -> None:
    resp = await client.post("/api/v1/auth/login", json={"email": creator.email, "password": PASSWORD})
    cookie = resp.headers["set-cookie"].lower()
    assert "vf_session=" in cookie and "httponly" in cookie and "samesite=lax" in cookie


async def test_password_change_invalidates_session(
    client: httpx.AsyncClient, admin: User, creator: User, app: object
) -> None:
    await login(client, creator)
    transport = httpx.ASGITransport(app=app)  # type: ignore[arg-type]
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as admin_client:
        await login(admin_client, admin)
        r = await admin_client.patch(f"/api/v1/users/{creator.id}", json={"password": "new-password-456"})
        assert r.status_code == 200
    assert (await client.get("/api/v1/auth/me")).status_code == 401


# ---- 權限 ---------------------------------------------------------------------


async def test_role_permissions(client: httpx.AsyncClient, creator: User) -> None:
    await login(client, creator)
    assert (await client.get("/api/v1/users")).status_code == 403
    assert (await client.get("/api/v1/audit-logs")).status_code == 403
    assert (await client.get("/api/v1/reviews/queue")).status_code == 403
    assert (await client.get("/api/v1/config/models")).status_code == 403
    assert (await client.patch("/api/v1/config/budget", json={"per_job_cny": 1})).status_code == 403


async def test_admin_manages_users(client: httpx.AsyncClient, admin: User) -> None:
    await login(client, admin)
    r = await client.post(
        "/api/v1/users",
        json={
            "email": "New@Example.com",
            "display_name": "新人",
            "password": "longpassword",
            "roles": ["creator"],
        },
    )
    assert r.status_code == 201 and r.json()["email"] == "new@example.com"
    dup = await client.post(
        "/api/v1/users",
        json={
            "email": "new@example.com",
            "display_name": "x",
            "password": "longpassword",
            "roles": ["creator"],
        },
    )
    assert dup.status_code == 409
    self_demote = await client.patch(f"/api/v1/users/{admin.id}", json={"roles": ["creator"]})
    assert self_demote.status_code == 409
    users = (await client.get("/api/v1/users")).json()
    assert {u["email"] for u in users} >= {"admin@example.com", "new@example.com"}


async def test_creator_cannot_see_others_jobs(
    client: httpx.AsyncClient, runtime: Runtime, templates: dict[str, Template], creator: User
) -> None:
    other = await make_user(runtime, roles=("creator",))
    await login(client, other)
    r = await client.post(
        "/api/v1/jobs", json={"template_id": str(templates["marketing"].id), "inputs": {"topic": "茶"}}
    )
    job_id = r.json()["id"]
    client.cookies.clear()
    await login(client, creator)
    assert (await client.get(f"/api/v1/jobs/{job_id}")).status_code == 404
    assert (await client.get("/api/v1/jobs")).json()["total"] == 0


# ---- 任務完整流程 -------------------------------------------------------------


async def test_marketing_flow_over_http(
    client: httpx.AsyncClient,
    dispatcher: InlineDispatcher,
    templates: dict[str, Template],
    admin: User,
    creator: User,
    app: object,
    tmp_path: Path,
) -> None:
    await login(client, creator)
    up = await client.post(
        "/api/v1/assets",
        data={"kind": "product", "tags": "綠茶, 商品"},
        files={"file": ("../../evil name.png", await png_bytes(tmp_path), "image/png")},
    )
    assert up.status_code == 201, up.text
    product = up.json()
    assert product["display_name"] == "evil name.png" and product["tags"] == ["綠茶", "商品"]
    assert product["thumbnail_url"]

    r = await client.post(
        "/api/v1/jobs",
        json={
            "template_id": str(templates["marketing"].id),
            "title": "綠茶推廣",
            "inputs": {"topic": "清晨的茶園，推廣自家綠茶"},
            "product_asset_ids": [product["id"]],
        },
    )
    assert r.status_code == 201, r.text
    job = r.json()
    assert job["status"] == "draft" and job["allowed_actions"] == ["submit", "cancel"]

    job = (await client.post(f"/api/v1/jobs/{job['id']}/submit")).json()
    assert job["status"] == "scripting"
    await dispatcher.drain()
    job = (await client.get(f"/api/v1/jobs/{job['id']}")).json()
    assert job["status"] == "storyboard_ready"
    assert {"edit_storyboard", "confirm_storyboard"} <= set(job["allowed_actions"])
    assert job["estimate"]["total_cny"] > 0

    scene = job["scenes"][1]
    patched = await client.patch(
        f"/api/v1/jobs/{job['id']}/scenes/{scene['id']}", json={"narration": "改過的旁白", "duration_s": 6}
    )
    assert patched.status_code == 200
    assert patched.json()["scenes"][1]["narration"] == "改過的旁白"

    confirmed = await client.post(f"/api/v1/jobs/{job['id']}/confirm-storyboard")
    assert confirmed.status_code == 200 and confirmed.json()["status"] == "generating"
    await dispatcher.drain()
    job = (await client.get(f"/api/v1/jobs/{job['id']}")).json()
    assert job["status"] == "in_review", job["error_message"]
    assert "review" not in job["allowed_actions"]  # 創作者不能審核
    assert "download" not in job["allowed_actions"]

    # 未審核前不能下載成片，但可以預覽（Range）
    final_id = job["final_asset_id"]
    assert (await client.get(f"/api/v1/assets/{final_id}/download")).status_code == 403
    part = await client.get(f"/api/v1/assets/{final_id}/content", headers={"Range": "bytes=0-99"})
    assert part.status_code == 206 and len(part.content) == 100
    assert part.headers["content-range"].startswith("bytes 0-99/")

    calls = (await client.get(f"/api/v1/jobs/{job['id']}/calls")).json()
    assert {c["provider"] for c in calls} >= {"llm", "seedream", "seedance", "tts"}
    assert sum(c["cost_cny"] for c in calls) == pytest.approx(job["actual_cost_cny"], abs=0.001)

    # 審核：換成審核者
    transport = httpx.ASGITransport(app=app)  # type: ignore[arg-type]
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as reviewer:
        await login(reviewer, admin)
        queue = (await reviewer.get("/api/v1/reviews/queue")).json()
        assert [j["id"] for j in queue] == [job["id"]]
        partial = {
            "ai_label": True,
            "no_real_person": True,
            "no_third_party_ip": True,
            "brand_guideline": True,
        }
        r = await reviewer.post(
            f"/api/v1/jobs/{job['id']}/review", json={"decision": "approved", "checklist": partial}
        )
        assert r.status_code == 422
        r = await reviewer.post(
            f"/api/v1/jobs/{job['id']}/review", json={"decision": "rejected", "checklist": {}}
        )
        assert r.status_code == 422
        full = {**partial, "subtitle_ok": True}
        r = await reviewer.post(
            f"/api/v1/jobs/{job['id']}/review", json={"decision": "approved", "checklist": full}
        )
        assert r.status_code == 200 and r.json()["status"] == "approved"
        assert r.json()["reviews"][0]["checklist"] == full

    job = (await client.get(f"/api/v1/jobs/{job['id']}")).json()
    assert job["allowed_actions"] == ["download"]
    dl = await client.get(f"/api/v1/assets/{final_id}/download")
    assert dl.status_code == 200 and "attachment" in dl.headers["content-disposition"]
    assert dl.content[4:8] == b"ftyp"


async def test_reject_then_edit_and_regenerate(
    client: httpx.AsyncClient, dispatcher: InlineDispatcher, templates: dict[str, Template], admin: User
) -> None:
    await login(client, admin)
    job = (
        await client.post(
            "/api/v1/jobs",
            json={
                "template_id": str(templates["marketing"].id),
                "inputs": {"topic": "咖啡"},
                "audio_mode": "none",
            },
        )
    ).json()
    await client.post(f"/api/v1/jobs/{job['id']}/submit")
    await dispatcher.drain()
    await client.post(f"/api/v1/jobs/{job['id']}/confirm-storyboard")
    await dispatcher.drain()
    r = await client.post(
        f"/api/v1/jobs/{job['id']}/review",
        json={"decision": "rejected", "checklist": {}, "reason": "第二鏡畫面不對"},
    )
    job = r.json()
    assert job["status"] == "rejected" and "edit_storyboard" in job["allowed_actions"]
    scene = job["scenes"][1]
    await client.patch(f"/api/v1/jobs/{job['id']}/scenes/{scene['id']}", json={"visual_prompt": "換一個畫面"})
    job = (await client.get(f"/api/v1/jobs/{job['id']}")).json()
    assert job["scenes"][1]["status"] == "pending" and job["scenes"][0]["status"] == "succeeded"
    await client.post(f"/api/v1/jobs/{job['id']}/confirm-storyboard")
    await dispatcher.drain()
    job = (await client.get(f"/api/v1/jobs/{job['id']}")).json()
    assert job["status"] == "in_review"
    assert job["scenes"][1]["attempt"] == 2 and job["scenes"][0]["attempt"] == 1


async def test_job_validation_errors(
    client: httpx.AsyncClient, templates: dict[str, Template], creator: User
) -> None:
    await login(client, creator)
    base = {"template_id": str(templates["marketing"].id), "inputs": {"topic": "茶"}}
    assert (await client.post("/api/v1/jobs", json={**base, "target_duration_s": 999})).status_code == 422
    assert (await client.post("/api/v1/jobs", json={**base, "target_duration_s": 60})).status_code == 422
    assert (await client.post("/api/v1/jobs", json={**base, "inputs": {"topic": "  "}})).status_code == 422
    training = {"template_id": str(templates["training"].id), "inputs": {"topic": "x"}, "audio_mode": "none"}
    assert (await client.post("/api/v1/jobs", json=training)).status_code == 422
    fake = {**base, "logo_asset_id": "00000000-0000-0000-0000-000000000000"}
    assert (await client.post("/api/v1/jobs", json=fake)).status_code == 422


async def test_confirm_over_budget_returns_409(
    client: httpx.AsyncClient, dispatcher: InlineDispatcher, templates: dict[str, Template], admin: User
) -> None:
    await login(client, admin)
    # 0.5 元夠寫腳本，不夠生成影片
    budget = await client.patch("/api/v1/config/budget", json={"per_job_cny": 0.5})
    assert budget.json()["per_job_cny"] == 0.5
    job = (
        await client.post(
            "/api/v1/jobs", json={"template_id": str(templates["marketing"].id), "inputs": {"topic": "茶"}}
        )
    ).json()
    await client.post(f"/api/v1/jobs/{job['id']}/submit")
    await dispatcher.drain()
    est = (await client.get(f"/api/v1/jobs/{job['id']}/estimate")).json()
    assert est["within_budget"] is False and est["budget_per_job_cny"] == 0.5, est
    r = await client.post(f"/api/v1/jobs/{job['id']}/confirm-storyboard")
    assert r.status_code == 409 and "超出預算" in r.json()["detail"]


async def test_cancel_and_resume_rules(
    client: httpx.AsyncClient, dispatcher: InlineDispatcher, templates: dict[str, Template], creator: User
) -> None:
    await login(client, creator)
    job = (
        await client.post(
            "/api/v1/jobs", json={"template_id": str(templates["quick"].id), "inputs": {"topic": "海浪"}}
        )
    ).json()
    assert (await client.post(f"/api/v1/jobs/{job['id']}/resume")).status_code == 409
    r = await client.post(f"/api/v1/jobs/{job['id']}/cancel")
    assert r.json()["status"] == "cancelled" and r.json()["allowed_actions"] == []
    assert (await client.post(f"/api/v1/jobs/{job['id']}/cancel")).status_code == 409


# ---- 素材 ---------------------------------------------------------------------


async def test_upload_rejects_wrong_type_and_size(
    client: httpx.AsyncClient, runtime: Runtime, creator: User, tmp_path: Path
) -> None:
    await login(client, creator)
    fake_png = await client.post(
        "/api/v1/assets",
        data={"kind": "product"},
        files={"file": ("x.png", b"<?php echo 1; ?>", "image/png")},
    )
    assert fake_png.status_code == 422
    audio = (await make_test_audio(tmp_path / "a.mp3", duration_s=1)).read_bytes()
    wrong_kind = await client.post(
        "/api/v1/assets", data={"kind": "logo"}, files={"file": ("a.mp3", audio, "audio/mpeg")}
    )
    assert wrong_kind.status_code == 422
    ok = await client.post(
        "/api/v1/assets", data={"kind": "bgm"}, files={"file": ("a.mp3", audio, "audio/mpeg")}
    )
    assert ok.status_code == 201 and ok.json()["duration_s"] == pytest.approx(1, abs=0.2)
    not_uploadable = await client.post(
        "/api/v1/assets", data={"kind": "final"}, files={"file": ("a.mp3", audio, "audio/mpeg")}
    )
    assert not_uploadable.status_code == 422
    runtime.settings.upload_max_image_bytes = 100
    big = await client.post(
        "/api/v1/assets",
        data={"kind": "product"},
        files={"file": ("p.png", await png_bytes(tmp_path), "image/png")},
    )
    assert big.status_code == 422 and "大小上限" in big.json()["detail"]


async def test_asset_list_filter_and_delete(
    client: httpx.AsyncClient, runtime: Runtime, creator: User, tmp_path: Path
) -> None:
    await login(client, creator)
    img = await png_bytes(tmp_path)
    a = (
        await client.post(
            "/api/v1/assets", data={"kind": "logo", "tags": "品牌"}, files={"file": ("logo.png", img)}
        )
    ).json()
    await client.post(
        "/api/v1/assets", data={"kind": "product", "tags": "茶"}, files={"file": ("tea.png", img)}
    )
    assert (await client.get("/api/v1/assets?kind=logo")).json()["total"] == 1
    assert (await client.get("/api/v1/assets?tag=茶")).json()["items"][0]["display_name"] == "tea.png"
    assert (await client.get("/api/v1/assets?q=tea")).json()["total"] == 1
    thumb = await client.get(a["thumbnail_url"])
    assert thumb.status_code == 200 and thumb.headers["content-type"] == "image/jpeg"
    other = await make_user(runtime, roles=("creator",))
    client.cookies.clear()
    await login(client, other)
    assert (await client.delete(f"/api/v1/assets/{a['id']}")).status_code == 403
    client.cookies.clear()
    await login(client, creator)
    assert (await client.delete(f"/api/v1/assets/{a['id']}")).status_code == 204
    assert (await client.get("/api/v1/assets?kind=logo")).json()["total"] == 0


# ---- 批量 ---------------------------------------------------------------------


async def test_batch_from_images(
    client: httpx.AsyncClient,
    dispatcher: InlineDispatcher,
    templates: dict[str, Template],
    creator: User,
    tmp_path: Path,
) -> None:
    await login(client, creator)
    img = await png_bytes(tmp_path)
    files = [("files", (f"商品{i}.png", img, "image/png")) for i in range(4)]
    r = await client.post(
        "/api/v1/batches/images",
        data={"template_id": str(templates["quick"].id), "topic": "商品緩慢旋轉展示", "max_parallel": "2"},
        files=files,
    )
    assert r.status_code == 201, r.text
    batch = r.json()
    assert batch["total"] == 4 and batch["counts"] == {"draft": 4}
    await dispatcher.drain()
    detail = (await client.get(f"/api/v1/batches/{batch['id']}")).json()
    assert detail["status"] == "done"
    assert [j["status"] for j in detail["jobs"]] == ["in_review"] * 4
    assert [j["title"] for j in detail["jobs"]] == [f"商品{i}" for i in range(4)]


async def test_batch_from_csv(
    client: httpx.AsyncClient, dispatcher: InlineDispatcher, templates: dict[str, Template], creator: User
) -> None:
    await login(client, creator)
    csv_text = "title,topic,extra\n綠茶,清晨的茶園,\n烏龍,午後的茶席,溫暖色調\n,,\n"
    r = await client.post(
        "/api/v1/batches/csv",
        data={"template_id": str(templates["marketing"].id), "max_parallel": "1"},
        files={"file": ("jobs.csv", io.BytesIO(csv_text.encode("utf-8-sig")), "text/csv")},
    )
    assert r.status_code == 201, r.text
    await dispatcher.drain()
    detail = (await client.get(f"/api/v1/batches/{r.json()['id']}")).json()
    assert [j["status"] for j in detail["jobs"]] == ["storyboard_ready"] * 2  # 非 quick 類型停在分鏡確認
    bad = await client.post(
        "/api/v1/batches/csv",
        data={"template_id": str(templates["marketing"].id)},
        files={"file": ("x.csv", b"name\nfoo\n", "text/csv")},
    )
    assert bad.status_code == 422


# ---- 用量、配置、審計 ---------------------------------------------------------


async def test_usage_config_and_audit(
    client: httpx.AsyncClient,
    dispatcher: InlineDispatcher,
    runtime: Runtime,
    templates: dict[str, Template],
    admin: User,
) -> None:
    await login(client, admin)
    job = (
        await client.post(
            "/api/v1/jobs", json={"template_id": str(templates["quick"].id), "inputs": {"topic": "海浪"}}
        )
    ).json()
    await client.post(f"/api/v1/jobs/{job['id']}/submit")
    await dispatcher.drain()
    usage = (await client.get("/api/v1/usage/summary?days=7")).json()
    assert usage["total_cny"] > 0 and usage["today_user_cny"] == pytest.approx(usage["total_cny"])
    assert usage["by_user"][0]["user_id"] == str(admin.id)
    assert usage["by_model"] and usage["by_day"]

    cfg = (await client.get("/api/v1/config/models")).json()
    assert cfg["region"] == "byteplus" and cfg["provider_mode"] == "mock" and cfg["currency"] == "USD"
    assert "capabilities" in cfg["models"]["video_final"]
    assert "api_key" not in str(cfg).lower()

    logs = (await client.get("/api/v1/audit-logs")).json()
    actions = {item["action"] for item in logs["items"]}
    assert {"login", "job_create", "job_submit"} <= actions
    only_login = (await client.get("/api/v1/audit-logs?action=login")).json()
    assert only_login["total"] >= 1 and all(i["action"] == "login" for i in only_login["items"])
    async with runtime.sessionmaker() as s:
        row = await s.scalar(select(AuditLog).where(AuditLog.action == "login"))
        assert row is not None and row.ip


async def test_templates_admin_crud(
    client: httpx.AsyncClient, templates: dict[str, Template], admin: User
) -> None:
    await login(client, admin)
    listed = (await client.get("/api/v1/templates")).json()
    assert {t["key"] for t in listed} == {"marketing", "quick", "training"}
    tpl = templates["quick"]
    r = await client.patch(f"/api/v1/templates/{tpl.id}", json={"is_active": False})
    assert r.json()["version"] == 2 and r.json()["is_active"] is False
    assert {t["key"] for t in (await client.get("/api/v1/templates")).json()} == {"marketing", "training"}
    assert len((await client.get("/api/v1/templates?include_inactive=true")).json()) == 3
    bad = await client.patch(f"/api/v1/templates/{tpl.id}", json={"min_shots": 5, "max_shots": 2})
    assert bad.status_code == 422


async def test_sse_stream_pushes_changes_and_pings(
    runtime: Runtime, client: httpx.AsyncClient, templates: dict[str, Template], creator: User
) -> None:
    from app.api.jobs import job_event_stream
    from app.models import Job

    await login(client, creator)
    job = (
        await client.post(
            "/api/v1/jobs", json={"template_id": str(templates["quick"].id), "inputs": {"topic": "海浪"}}
        )
    ).json()
    job_id = uuid.UUID(job["id"])
    ticks = 0

    async def disconnected() -> bool:
        nonlocal ticks
        ticks += 1
        return ticks > 6

    events = []
    async for chunk in job_event_stream(runtime, job_id, creator, disconnected, poll_s=0.001, ping_s=0.002):
        events.append(chunk)
        if len(events) == 1:  # 第一次推送後改狀態，應再推送一次
            async with runtime.sessionmaker() as s:
                row = await s.get(Job, job_id)
                assert row is not None
                row.status = "cancelled"
                await s.commit()
    data_events = [e for e in events if e.startswith("event: job")]
    assert len(data_events) == 2
    assert '"status":"draft"' in data_events[0] and '"status":"cancelled"' in data_events[1]
    assert any(e.startswith(": ping") for e in events)


async def test_sse_requires_access(
    runtime: Runtime, client: httpx.AsyncClient, templates: dict[str, Template], creator: User
) -> None:
    other = await make_user(runtime, roles=("creator",))
    await login(client, other)
    job = (
        await client.post(
            "/api/v1/jobs", json={"template_id": str(templates["quick"].id), "inputs": {"topic": "海浪"}}
        )
    ).json()
    client.cookies.clear()
    await login(client, creator)
    assert (await client.get(f"/api/v1/jobs/{job['id']}/events")).status_code == 404
