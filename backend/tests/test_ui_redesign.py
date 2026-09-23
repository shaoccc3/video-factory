"""規格 14（介面改版）的後端接口：列表多狀態與排序、preview_asset_id、開新片的即時預估。全部用 MockProvider。"""

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from sqlalchemy import event, func, select, update

from app.models import CostLedger, GenerationCall, Job, Scene, Template, User
from app.models.enums import AssetKind, JobStatus, SceneStatus
from app.pipeline.estimate import synthetic_scenes
from app.providers.mock import MockLLM
from app.services.jobs import EstimateInput, preview_job
from app.services.runtime import Runtime
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
