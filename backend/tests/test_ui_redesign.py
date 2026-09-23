"""規格 14（介面改版）的後端接口：列表多狀態與排序、preview_asset_id、開新片的即時預估、首幀預覽。

全部用 MockProvider。
"""

import json
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import Mock

import httpx
import pytest
from sqlalchemy import event, func, select, update

from app.api.jobs import job_event_stream
from app.models import CostLedger, GenerationCall, Job, Scene, Template, User
from app.models.enums import AssetKind, ErrorKind, JobStatus, SceneStatus
from app.pipeline.estimate import synthetic_scenes
from app.providers.errors import ProviderError
from app.providers.mock import MockLLM, MockSeedance, MockSeedream
from app.services.jobs import EstimateInput, preview_job
from app.services.runtime import Runtime
from app.workers import app as celery_app
from app.workers.dispatch import TASK_KEYFRAME, CeleryDispatcher
from tests.conftest import make_user
from tests.helpers import InlineDispatcher, make_asset, new_job, setup_templates
from tests.test_api import login

pytestmark = pytest.mark.anyio


@pytest.fixture
async def templates(runtime: Runtime) -> dict[str, Template]:
    return await setup_templates(runtime)


@pytest.fixture
async def admin(runtime: Runtime) -> User:
    return await make_user(runtime, roles=("admin", "reviewer", "creator"), email="admin@example.com")


@pytest.fixture
async def creator(runtime: Runtime) -> User:
    return await make_user(runtime, roles=("creator",), email="creator@example.com")


@contextmanager
def count_queries(runtime: Runtime) -> Iterator[list[str]]:
    statements: list[str] = []

    def record(*args: object) -> None:
        statements.append(str(args[2]))

    engine = runtime.engine.sync_engine
    event.listen(engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", record)


async def set_job(runtime: Runtime, job_id: uuid.UUID, **values: object) -> None:
    async with runtime.sessionmaker() as s:
        await s.execute(update(Job).where(Job.id == job_id).values(**values))
        await s.commit()


# ---- GET /jobs：多個 status、sort ---------------------------------------------


async def test_list_jobs_multi_status_and_sort(
    client: httpx.AsyncClient, runtime: Runtime, templates: dict[str, Template], creator: User
) -> None:
    base = datetime(2026, 9, 1, tzinfo=UTC)
    plan = [  # (狀態, 建立時間偏移, 更新時間偏移)：建立順序與更新順序刻意不同
        (JobStatus.GENERATING, 0, 30),
        (JobStatus.COMPOSING, 1, 10),
        (JobStatus.DRAFT, 2, 20),
        (JobStatus.GENERATING, 3, 5),
    ]
    ids: list[str] = []
    for i, (job_status, created, updated) in enumerate(plan):
        job = await new_job(runtime, creator, templates["marketing"], title=f"片{i}")
        await set_job(
            runtime,
            job.id,
            status=job_status.value,
            created_at=base + timedelta(minutes=created),
            updated_at=base + timedelta(minutes=updated),
        )
        ids.append(str(job.id))
    await login(client, creator)

    def listed(resp: httpx.Response) -> list[str]:
        assert resp.status_code == 200, resp.text
        return [j["id"] for j in resp.json()["items"]]

    # 預設按建立時間由新到舊
    assert listed(await client.get("/api/v1/jobs")) == [ids[3], ids[2], ids[1], ids[0]]
    # 單一 status 行為不變
    single = await client.get("/api/v1/jobs", params={"status": "generating"})
    assert listed(single) == [ids[3], ids[0]] and single.json()["total"] == 2
    # 多個 status
    multi = await client.get("/api/v1/jobs", params=[("status", "generating"), ("status", "composing")])
    assert listed(multi) == [ids[3], ids[1], ids[0]] and multi.json()["total"] == 3
    # sort=updated：按更新時間由新到舊
    by_updated = await client.get("/api/v1/jobs", params={"sort": "updated"})
    assert listed(by_updated) == [ids[0], ids[2], ids[1], ids[3]]
    both = await client.get(
        "/api/v1/jobs", params=[("status", "generating"), ("status", "composing"), ("sort", "updated")]
    )
    assert listed(both) == [ids[0], ids[1], ids[3]]
    first_page = await client.get("/api/v1/jobs", params={"sort": "created", "page_size": 2})
    assert listed(first_page) == [ids[3], ids[2]]
    assert (await client.get("/api/v1/jobs", params={"sort": "title"})).status_code == 422
    assert (await client.get("/api/v1/jobs", params={"status": "nope"})).status_code == 422


# ---- JobSummary.preview_asset_id ---------------------------------------------


async def test_preview_asset_id_sources(
    client: httpx.AsyncClient, runtime: Runtime, templates: dict[str, Template], creator: User, tmp_path: Path
) -> None:
    assets = [await make_asset(runtime, creator, AssetKind.IMAGE, tmp_path) for _ in range(6)]
    cover, last0, last1, last_pending, first1, first2 = (a.id for a in assets)
    tpl = templates["marketing_multi"]
    with_cover = await new_job(runtime, creator, tpl, title="有封面")
    with_last = await new_job(runtime, creator, tpl, title="有尾幀")
    with_first = await new_job(runtime, creator, tpl, title="只有首幀")
    empty = await new_job(runtime, creator, tpl, title="沒有畫面")
    await set_job(runtime, with_cover.id, cover_asset_id=cover)
    ok, pending = SceneStatus.SUCCEEDED.value, SceneStatus.PENDING.value
    rows = [
        # 有封面：封面優先，即使鏡頭有尾幀與首幀
        (with_cover.id, 0, ok, first1, last0),
        # 最後一個「成功」鏡頭的尾幀；未成功鏡頭的尾幀不算；尾幀優先於首幀
        (with_last.id, 0, ok, first1, last0),
        (with_last.id, 1, ok, None, last1),
        (with_last.id, 2, pending, None, last_pending),
        # 沒有成功鏡頭的尾幀：取第一個有首幀的鏡頭
        (with_first.id, 0, pending, None, None),
        (with_first.id, 1, pending, first1, None),
        (with_first.id, 2, pending, first2, last_pending),
        (empty.id, 0, pending, None, None),
    ]
    async with runtime.sessionmaker() as s:
        for job_id, index, scene_status, first, last in rows:
            s.add(
                Scene(
                    job_id=job_id,
                    index=index,
                    duration_s=5,
                    visual_prompt="畫面",
                    status=scene_status,
                    first_frame_asset_id=first,
                    last_frame_asset_id=last,
                )
            )
        await s.commit()
    await login(client, creator)
    items = {j["title"]: j for j in (await client.get("/api/v1/jobs")).json()["items"]}
    assert items["有封面"]["preview_asset_id"] == str(cover)
    assert items["有尾幀"]["preview_asset_id"] == str(last1)
    assert items["只有首幀"]["preview_asset_id"] == str(first1)
    assert items["沒有畫面"]["preview_asset_id"] is None
    detail = (await client.get(f"/api/v1/jobs/{with_last.id}")).json()
    assert detail["preview_asset_id"] == str(last1)

    # 列表不因任務數增加而多查詢（沒有 N+1）
    with count_queries(runtime) as one_page:
        resp = await client.get("/api/v1/jobs", params={"q": "有尾幀"})
    assert resp.json()["total"] == 1
    with count_queries(runtime) as full_page:
        resp = await client.get("/api/v1/jobs")
    assert resp.json()["total"] == 4
    assert len(full_page) == len(one_page)
    assert sum("FROM scenes" in q for q in full_page) == 2  # 進度統計 + 畫面來源


# ---- POST /jobs/estimate -------------------------------------------------------


@pytest.mark.parametrize("draft_mode", [False, True])
async def test_estimate_preview_matches_job_estimate(
    client: httpx.AsyncClient, runtime: Runtime, dispatcher: InlineDispatcher, creator: User, draft_mode: bool
) -> None:
    """行銷 30 秒 720p 9:16：預估假設 2 鏡 × 15 秒、每鏡都生成首幀；分鏡相同的任務，兩個預估完全一致。"""
    templates = await setup_templates(runtime, resolution="720p")
    tpl = templates["marketing"]
    await login(client, creator)
    params = {"template_id": str(tpl.id), "target_duration_s": 30, "ratio": "9:16", "draft_mode": draft_mode}
    r = await client.post("/api/v1/jobs/estimate", json={**params, "resolution": "720p"})
    assert r.status_code == 200, r.text
    preview = r.json()
    assert set(preview) == {"total_cny", "items", "budget_per_job_cny", "within_budget"}
    assert preview["total_cny"] > 0 and preview["within_budget"] is True
    assert preview["budget_per_job_cny"] == runtime.config.budget.per_job_cny
    [keyframes] = [i for i in preview["items"] if i["model_key"] == "keyframe"]
    assert keyframes["quantity"] == 2
    labels = [i["label"] for i in preview["items"]]
    assert any(label.startswith("正片") for label in labels) is draft_mode

    llm = runtime.providers.llm
    assert isinstance(llm, MockLLM)
    shot = {"narration": "清晨的茶園。", "duration_s": 15, "needs_first_frame": True}
    llm.scripted.append(
        {"title": "茶", "scenes": [{**shot, "visual_prompt": f"茶園，鏡頭{i}"} for i in range(2)]}
    )
    created = await client.post("/api/v1/jobs", json={**params, "inputs": {"topic": "清晨的茶園"}})
    assert created.status_code == 201, created.text
    job_id = created.json()["id"]
    await client.post(f"/api/v1/jobs/{job_id}/submit")
    await dispatcher.drain()
    job = (await client.get(f"/api/v1/jobs/{job_id}")).json()
    assert job["status"] == "storyboard_ready"
    assert [(s["duration_s"], s["needs_first_frame"]) for s in job["scenes"]] == [(15, True), (15, True)]
    estimate = (await client.get(f"/api/v1/jobs/{job_id}/estimate")).json()
    assert estimate["items"] == preview["items"]
    assert estimate["total_cny"] == preview["total_cny"]


async def test_estimate_preview_synthetic_scenes(runtime: Runtime, templates: dict[str, Template]) -> None:
    """鏡頭數取模板上下限中間值（向上取整），時長平均分配並按模型能力取整、夾緊。"""

    async def durations(key: str, target_duration_s: float | None = None) -> list[float]:
        data = EstimateInput(template_id=templates[key].id, target_duration_s=target_duration_s)
        async with runtime.sessionmaker() as s:
            job = await preview_job(s, runtime.config, "byteplus", data)
        scenes = synthetic_scenes(runtime.config, job)
        assert all(sc.needs_first_frame and sc.first_frame_asset_id is None for sc in scenes)
        return [sc.duration_s for sc in scenes]

    assert await durations("marketing", target_duration_s=30) == [15.0, 15.0]  # 1～2 鏡 → 2 鏡
    assert await durations("marketing") == [11.0, 11.0]  # 未填時長：取 15～30 的中間值 22.5 秒
    assert await durations("marketing_multi", target_duration_s=20) == [5.0] * 4  # 3～4 鏡 → 4 鏡
    assert await durations("marketing_multi", target_duration_s=15) == [4.0] * 4  # 3.75 秒取整為 4
    assert await durations("quick") == [10.0]  # 單鏡；5～15 秒取中間值
    assert await durations("training", target_duration_s=60) == [8.0] * 8  # 4～12 鏡 → 8 鏡，7.5 秒取整


async def test_estimate_preview_validation_and_side_effects(
    client: httpx.AsyncClient, runtime: Runtime, templates: dict[str, Template], admin: User
) -> None:
    await login(client, admin)
    url = "/api/v1/jobs/estimate"
    base = {"template_id": str(templates["marketing"].id)}
    ok = await client.post(url, json=base)
    assert ok.status_code == 200, ok.text
    # 與 POST /jobs 相同的校驗：時長範圍、國際版不能選 TTS、培訓片不能無聲、模板不存在
    for bad in (
        {**base, "target_duration_s": 60},
        {**base, "target_duration_s": 999},
        {**base, "audio_mode": "tts"},
        {**base, "ratio": "2:1"},
        {**base, "resolution": "4k"},
        {"template_id": str(templates["training"].id), "audio_mode": "none"},
        {"template_id": str(uuid.uuid4())},
        {},
    ):
        r = await client.post(url, json=bad)
        assert r.status_code == 422, (bad, r.text)
    tts = await client.post(url, json={**base, "audio_mode": "tts"})
    assert "TTS" in tts.json()["detail"]
    await client.patch(f"/api/v1/templates/{templates['quick'].id}", json={"is_active": False})
    assert (await client.post(url, json={"template_id": str(templates["quick"].id)})).status_code == 422

    # 樣片模式：正片是確認後才花的錢，不計入 within_budget；單任務上限跟著預算設定
    await client.patch("/api/v1/config/budget", json={"per_job_cny": 1})
    tight = (await client.post(url, json=base)).json()
    assert tight["budget_per_job_cny"] == 1 and tight["within_budget"] is False
    await client.patch("/api/v1/config/budget", json={"per_job_cny": 1000})
    assert (await client.post(url, json={**base, "draft_mode": True})).json()["within_budget"] is True

    # 不寫數據庫、不調用模型
    async with runtime.sessionmaker() as s:
        for model in (Job, Scene, GenerationCall, CostLedger):
            assert await s.scalar(select(func.count()).select_from(model)) == 0


async def test_estimate_preview_tts_and_permissions(
    client: httpx.AsyncClient, runtime: Runtime, templates: dict[str, Template]
) -> None:
    reviewer = await make_user(runtime, roles=("reviewer",))
    await login(client, reviewer)
    body = {"template_id": str(templates["training"].id), "target_duration_s": 60}
    assert (await client.post("/api/v1/jobs/estimate", json=body)).status_code == 403  # 只能看、不能開新片
    client.cookies.clear()
    assert (await client.post("/api/v1/jobs/estimate", json=body)).status_code == 401

    creator = await make_user(runtime, roles=("creator",))
    await login(client, creator)
    intl = (await client.post("/api/v1/jobs/estimate", json=body)).json()
    assert all(i["model_key"] != "tts" for i in intl["items"])  # 國際版：培訓片改用原生聲音
    runtime.settings.ark_region = "volcengine"
    cn = (await client.post("/api/v1/jobs/estimate", json=body)).json()
    [tts] = [i for i in cn["items"] if i["model_key"] == "tts"]
    assert tts["unit"] == "字" and tts["quantity"] > 0 and tts["amount_cny"] > 0


# ---- 首幀預覽 -----------------------------------------------------------------


def seedream(runtime: Runtime) -> MockSeedream:
    sd = runtime.providers.seedream
    assert isinstance(sd, MockSeedream)
    return sd


def seedance(runtime: Runtime) -> MockSeedance:
    sd = runtime.providers.seedance
    assert isinstance(sd, MockSeedance)
    return sd


async def storyboard_job(
    client: httpx.AsyncClient, dispatcher: InlineDispatcher, template: Template
) -> dict[str, Any]:
    r = await client.post(
        "/api/v1/jobs", json={"template_id": str(template.id), "inputs": {"topic": "清晨的茶園"}}
    )
    assert r.status_code == 201, r.text
    job_id = r.json()["id"]
    await client.post(f"/api/v1/jobs/{job_id}/submit")
    await dispatcher.drain()
    job: dict[str, Any] = (await client.get(f"/api/v1/jobs/{job_id}")).json()
    assert job["status"] == "storyboard_ready"
    return job


async def get_job(client: httpx.AsyncClient, job: dict[str, Any]) -> dict[str, Any]:
    fresh: dict[str, Any] = (await client.get(f"/api/v1/jobs/{job['id']}")).json()
    return fresh


def preview_url(job: dict[str, Any], scene: dict[str, Any]) -> str:
    return f"/api/v1/jobs/{job['id']}/scenes/{scene['id']}/keyframe-preview"


async def keyframe_charges(runtime: Runtime, scene_id: str) -> tuple[int, int]:
    """這一鏡的 Seedream 調用數與關鍵幀記賬筆數。"""
    sid = uuid.UUID(scene_id)
    async with runtime.sessionmaker() as s:
        calls = await s.scalar(
            select(func.count())
            .select_from(GenerationCall)
            .where(GenerationCall.scene_id == sid, GenerationCall.provider == "seedream")
        )
        charges = await s.scalar(
            select(func.count())
            .select_from(CostLedger)
            .join(GenerationCall, GenerationCall.id == CostLedger.generation_call_id)
            .where(GenerationCall.scene_id == sid, CostLedger.model_key == "keyframe")
        )
    return int(calls or 0), int(charges or 0)


async def test_keyframe_preview_generates_then_reused_on_confirm(
    client: httpx.AsyncClient,
    runtime: Runtime,
    dispatcher: InlineDispatcher,
    templates: dict[str, Template],
    creator: User,
) -> None:
    await login(client, creator)
    job = await storyboard_job(client, dispatcher, templates["marketing_multi"])
    assert "preview_keyframe" in job["allowed_actions"]
    scene = job["scenes"][0]
    assert scene["needs_first_frame"] and scene["first_frame_asset_id"] is None  # 不預覽的話，開拍時才生成

    r = await client.post(preview_url(job, scene))  # 請求體可省略
    assert r.status_code == 202, r.text
    assert r.json()["scenes"][0]["status"] == "keyframe" and r.json()["status"] == "storyboard_ready"
    assert [kind for kind, _ in dispatcher.queue] == ["keyframe"]
    assert seedream(runtime).calls == 0  # 請求內不等待生成

    # 生成中：確認開拍、重寫分鏡、同一鏡再送一次、編輯這一鏡都回 409
    for action in ("confirm-storyboard", "regenerate-script"):
        r = await client.post(f"/api/v1/jobs/{job['id']}/{action}")
        assert r.status_code == 409 and r.json()["detail"] == "首幀預覽還在生成", r.text
    again = await client.post(preview_url(job, scene), json={"force": True})
    assert again.status_code == 409 and again.json()["detail"] == "首幀預覽還在生成"
    edit = await client.patch(f"/api/v1/jobs/{job['id']}/scenes/{scene['id']}", json={"narration": "改"})
    assert edit.status_code == 409

    # worker 完成後 SSE 推送新的首幀
    ticks = 0

    async def disconnected() -> bool:
        nonlocal ticks
        ticks += 1
        return ticks > 4

    events: list[dict[str, Any]] = []
    stream = job_event_stream(runtime, uuid.UUID(job["id"]), creator, disconnected, poll_s=0.001, ping_s=60)
    async for chunk in stream:
        if chunk.startswith("event: job"):
            events.append(json.loads(chunk.split("data: ", 1)[1]))
            if len(events) == 1:
                await dispatcher.drain()
    assert [e["scenes"][0]["status"] for e in events] == ["keyframe", "pending"]
    done = events[-1]["scenes"][0]
    assert done["first_frame_asset_id"] and done["needs_first_frame"] and done["error_kind"] is None
    assert events[-1]["status"] == "storyboard_ready"
    assert events[-1]["actual_cost_cny"] > events[0]["actual_cost_cny"]  # 照常記賬
    assert events[-1]["updated_at"] >= events[0]["updated_at"]
    frame_id = done["first_frame_asset_id"]
    assert await keyframe_charges(runtime, scene["id"]) == (1, 1)
    async with runtime.sessionmaker() as s:
        call = await s.scalar(select(GenerationCall).where(GenerationCall.provider == "seedream"))
    assert call is not None and call.user_id == creator.id and call.status == "succeeded"
    # 預估不再計這一鏡的首幀
    estimate = (await client.get(f"/api/v1/jobs/{job['id']}/estimate")).json()
    assert all(item["model_key"] != "keyframe" for item in estimate["items"])

    # 確認開拍後沿用預覽的首幀：Seedream 只調用一次、只記一次賬
    r = await client.post(f"/api/v1/jobs/{job['id']}/confirm-storyboard")
    assert r.status_code == 200 and r.json()["status"] == "generating"
    await dispatcher.drain()
    job = await get_job(client, job)
    assert job["status"] == "in_review", job["error_message"]
    assert job["scenes"][0]["first_frame_asset_id"] == frame_id
    assert seedream(runtime).calls == 1
    assert await keyframe_charges(runtime, scene["id"]) == (1, 1)
    first_frames = [
        img.url for req in seedance(runtime).created for img in req.images if img.role == "first_frame"
    ]
    assert first_frames == [f"asset://{frame_id}"]


async def test_keyframe_preview_conflicts_and_force(
    client: httpx.AsyncClient,
    runtime: Runtime,
    dispatcher: InlineDispatcher,
    templates: dict[str, Template],
    creator: User,
    tmp_path: Path,
) -> None:
    await login(client, creator)
    job = await storyboard_job(client, dispatcher, templates["marketing_multi"])
    other = await storyboard_job(client, dispatcher, templates["marketing_multi"])
    scene = job["scenes"][1]
    assert not scene["needs_first_frame"]

    # 不屬於這個任務的鏡頭：404
    r = await client.post(preview_url(job, other["scenes"][0]))
    assert r.status_code == 404

    # 已有首幀（從素材替換）且沒有 force：409；force 時清掉並重新生成
    product = await make_asset(runtime, creator, AssetKind.PRODUCT, tmp_path)
    await client.patch(
        f"/api/v1/jobs/{job['id']}/scenes/{scene['id']}", json={"first_frame_asset_id": str(product.id)}
    )
    r = await client.post(preview_url(job, scene), json={})
    assert r.status_code == 409 and "force" in r.json()["detail"]
    r = await client.post(preview_url(job, scene), json={"force": True})
    assert r.status_code == 202, r.text
    claimed = r.json()["scenes"][1]
    assert claimed["status"] == "keyframe" and claimed["first_frame_asset_id"] is None
    await dispatcher.drain()
    first = (await get_job(client, job))["scenes"][1]
    assert first["status"] == "pending" and first["needs_first_frame"]
    assert first["first_frame_asset_id"] not in (None, str(product.id))

    # 重新生成已生成的首幀
    r = await client.post(preview_url(job, scene), json={"force": True})
    assert r.status_code == 202
    await dispatcher.drain()
    second = (await get_job(client, job))["scenes"][1]
    assert second["first_frame_asset_id"] not in (None, first["first_frame_asset_id"])
    assert seedream(runtime).calls == 2 and await keyframe_charges(runtime, scene["id"]) == (2, 2)

    # 審核者看得到任務但不能操作：403，也沒有 preview_keyframe；其他創作者看不到：404
    reviewer = await make_user(runtime, roles=("reviewer",))
    stranger = await make_user(runtime, roles=("creator",))
    client.cookies.clear()
    await login(client, reviewer)
    assert "preview_keyframe" not in (await get_job(client, job))["allowed_actions"]
    assert (await client.post(preview_url(job, scene), json={"force": True})).status_code == 403
    client.cookies.clear()
    await login(client, stranger)
    assert (await client.post(preview_url(job, scene), json={"force": True})).status_code == 404
    client.cookies.clear()
    await login(client, creator)

    # 不是分鏡待確認：409
    assert (await client.post(f"/api/v1/jobs/{job['id']}/confirm-storyboard")).status_code == 200
    r = await client.post(preview_url(job, job["scenes"][2]))
    assert r.status_code == 409 and "待確認" in r.json()["detail"]
    await dispatcher.drain()
    job = await get_job(client, job)
    assert job["status"] == "in_review" and "preview_keyframe" not in job["allowed_actions"]
    assert (await client.post(preview_url(job, job["scenes"][2]))).status_code == 409
    assert seedream(runtime).calls == 3  # 開拍時第一鏡照常生成首幀；預覽過的第二鏡沿用
    assert await keyframe_charges(runtime, scene["id"]) == (2, 2)


async def test_keyframe_preview_failure_writes_scene_error(
    client: httpx.AsyncClient,
    runtime: Runtime,
    dispatcher: InlineDispatcher,
    templates: dict[str, Template],
    creator: User,
) -> None:
    await login(client, creator)
    job = await storyboard_job(client, dispatcher, templates["marketing_multi"])
    scene = job["scenes"][0]
    failures = seedream(runtime).failures.errors
    failures.append(
        ProviderError(
            ErrorKind.MODERATION, "輸出圖片未通過內容審核", code="OutputImageSensitiveContentDetected"
        )
    )
    assert (await client.post(preview_url(job, scene))).status_code == 202
    await dispatcher.drain()
    job = await get_job(client, job)
    failed = job["scenes"][0]
    assert failed["status"] == "pending" and failed["first_frame_asset_id"] is None
    assert failed["error_kind"] == "moderation" and "審核" in failed["error_message"]
    assert job["status"] == "storyboard_ready" and job["error_kind"] is None  # 任務狀態不變
    assert "preview_keyframe" in job["allowed_actions"]
    assert seedream(runtime).calls == 1  # 內容審核不重試
    assert await keyframe_charges(runtime, scene["id"]) == (1, 0)  # 失敗不記賬

    # 重試：送出時清除錯誤；服務端錯誤由網關自動重試
    failures.append(ProviderError(ErrorKind.SERVER, "暫時無法服務"))
    r = await client.post(preview_url(job, scene))
    assert r.status_code == 202 and r.json()["scenes"][0]["error_kind"] is None
    await dispatcher.drain()
    retried = (await get_job(client, job))["scenes"][0]
    assert retried["first_frame_asset_id"] and retried["error_kind"] is None
    assert seedream(runtime).calls == 3

    # 預算不足：鏡頭記 budget 錯誤，任務仍待確認，不調用模型
    await set_job(runtime, uuid.UUID(job["id"]), budget_cny=0.0001)
    assert (await client.post(preview_url(job, job["scenes"][1]))).status_code == 202
    await dispatcher.drain()
    job = await get_job(client, job)
    assert job["scenes"][1]["status"] == "pending" and job["scenes"][1]["error_kind"] == "budget"
    assert job["scenes"][1]["error_message"] and job["status"] == "storyboard_ready"
    assert seedream(runtime).calls == 3


async def test_keyframe_preview_skipped_after_cancel(
    client: httpx.AsyncClient,
    runtime: Runtime,
    dispatcher: InlineDispatcher,
    templates: dict[str, Template],
    creator: User,
) -> None:
    await login(client, creator)
    job = await storyboard_job(client, dispatcher, templates["marketing_multi"])
    assert (await client.post(preview_url(job, job["scenes"][0]))).status_code == 202
    cancelled = await client.post(f"/api/v1/jobs/{job['id']}/cancel")
    assert cancelled.json()["status"] == "cancelled"
    await dispatcher.drain()
    job = await get_job(client, job)
    assert job["scenes"][0]["status"] == "cancelled" and job["scenes"][0]["first_frame_asset_id"] is None
    assert seedream(runtime).calls == 0


def test_keyframe_preview_celery_dispatch() -> None:
    import app.workers.tasks  # noqa: F401 - 註冊 Celery 任務

    celery = Mock()
    job_id, scene_id = uuid.uuid4(), uuid.uuid4()
    CeleryDispatcher(celery).keyframe(job_id, scene_id)
    celery.send_task.assert_called_once_with(TASK_KEYFRAME, args=[str(job_id), str(scene_id)])
    assert TASK_KEYFRAME in celery_app.tasks
