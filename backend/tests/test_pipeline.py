"""P5～P10：腳本分鏡、關鍵幀、分鏡生成、配音字幕、合成、編排。全部用 MockProvider。"""

from pathlib import Path

import pytest
from sqlalchemy import func, select, update

from app.media.ffmpeg import probe
from app.models import Asset, Batch, CostLedger, GenerationCall, Scene, Template, User
from app.models.enums import AssetKind, AudioMode, JobStatus, SceneStatus
from app.pipeline import orchestrator
from app.pipeline.common import StoryboardRules, check_storyboard, normalize_storyboard
from app.pipeline.content_check import check_texts, load_blocklist
from app.pipeline.orchestrator import ActionError
from app.pipeline.schemas import SceneDraft
from app.providers.gateway import Gateway
from app.providers.mock import MockLLM, MockSeedance
from app.services.jobs import update_scene
from app.services.runtime import Runtime
from app.services.settings_store import set_budget
from tests.helpers import InlineDispatcher, make_asset, new_job, reload, setup_templates

pytestmark = pytest.mark.anyio


@pytest.fixture
async def templates(runtime: Runtime) -> dict[str, Template]:
    return await setup_templates(runtime)


async def scenes_of(runtime: Runtime, job_id: object) -> list[Scene]:
    async with runtime.sessionmaker() as s:
        return list(
            (await s.scalars(select(Scene).where(Scene.job_id == job_id).order_by(Scene.index))).all()
        )


async def calls_by_provider(runtime: Runtime) -> dict[str, int]:
    async with runtime.sessionmaker() as s:
        rows = await s.execute(
            select(GenerationCall.provider, func.count()).group_by(GenerationCall.provider)
        )
        return {p: int(c) for p, c in rows.all()}


def seedance(runtime: Runtime) -> MockSeedance:
    sd = runtime.providers.seedance
    assert isinstance(sd, MockSeedance)
    return sd


# ---- 完整流程 -----------------------------------------------------------------


async def test_marketing_end_to_end(
    runtime: Runtime, dispatcher: InlineDispatcher, templates: dict[str, Template], user: User, tmp_path: Path
) -> None:
    product = await make_asset(runtime, user, AssetKind.PRODUCT, tmp_path)
    logo = await make_asset(runtime, user, AssetKind.LOGO, tmp_path)
    bgm = await make_asset(runtime, user, AssetKind.BGM, tmp_path)
    job = await new_job(
        runtime,
        user,
        templates["marketing"],
        product_asset_ids=[product.id],
        logo_asset_id=logo.id,
        bgm_asset_id=bgm.id,
    )
    await orchestrator.submit(runtime, dispatcher, job.id)
    await dispatcher.drain()

    job = await reload(runtime, job.id)
    assert job.status == JobStatus.STORYBOARD_READY
    scenes = await scenes_of(runtime, job.id)
    assert 3 <= len(scenes) <= 6
    assert 15 <= sum(s.duration_s for s in scenes) <= 30
    assert scenes[0].needs_first_frame and scenes[0].ref_asset_ids == [str(product.id)]
    assert job.estimated_cost_cny and job.estimated_cost_cny > 0
    assert seedance(runtime).created == []  # 確認前不得調用 Seedance

    await orchestrator.confirm_storyboard(runtime, dispatcher, job.id)
    await dispatcher.drain()
    job = await reload(runtime, job.id)
    assert job.status == JobStatus.IN_REVIEW, job.error_message
    assert job.final_asset_id and job.cover_asset_id and job.subtitle_asset_id

    scenes = await scenes_of(runtime, job.id)
    assert all(s.status == SceneStatus.SUCCEEDED and s.audio_asset_id for s in scenes)
    assert scenes[0].first_frame_generated
    first_request = seedance(runtime).created[0]
    assert [img.role for img in first_request.images] == ["first_frame"]
    assert all(r.safety_identifier == str(user.id) for r in seedance(runtime).created)

    async with runtime.sessionmaker() as s:
        final = await s.get(Asset, job.final_asset_id)
        assert final is not None
        ledger_total = await s.scalar(
            select(func.sum(CostLedger.amount_cny)).where(CostLedger.job_id == job.id)
        )
    dest = tmp_path / "final.mp4"
    runtime.storage.download_to(final.storage_key, dest)
    info = await probe(dest)
    assert (info.width, info.height) == (480, 854)
    assert info.video_codec == "h264" and info.audio_codec == "aac"
    assert info.tags["aigc_label"] == "AI生成" and info.tags["aigc_content_id"] == str(job.id)
    assert info.duration_s and info.duration_s > 15
    assert job.actual_cost_cny == pytest.approx(float(ledger_total or 0), rel=1e-6)
    counts = await calls_by_provider(runtime)
    assert counts["llm"] >= 1 and counts["seedream"] == 1
    assert counts["seedance"] == len(scenes) and counts["tts"] == len(scenes)


async def test_quick_image_to_video_auto_confirms(
    runtime: Runtime, dispatcher: InlineDispatcher, templates: dict[str, Template], user: User, tmp_path: Path
) -> None:
    image = await make_asset(runtime, user, AssetKind.PRODUCT, tmp_path)
    job = await new_job(runtime, user, templates["quick"], image_asset_id=image.id, topic="商品緩慢旋轉展示")
    await orchestrator.submit(runtime, dispatcher, job.id)
    await dispatcher.drain()
    job = await reload(runtime, job.id)
    assert job.status == JobStatus.IN_REVIEW
    [req] = seedance(runtime).created
    assert req.images[0].role == "first_frame" and req.images[0].url == f"asset://{image.id}"
    assert "llm" not in await calls_by_provider(runtime)  # 跳過腳本
    assert job.subtitle_asset_id is None


async def test_training_narration_drives_duration(
    runtime: Runtime, dispatcher: InlineDispatcher, templates: dict[str, Template], user: User
) -> None:
    job = await new_job(
        runtime, user, templates["training"], topic="資訊安全基礎：如何辨識釣魚郵件", target_duration_s=60
    )
    assert job.ratio == "16:9"
    await orchestrator.submit(runtime, dispatcher, job.id)
    await dispatcher.drain()
    scenes = await scenes_of(runtime, job.id)
    assert 6 <= len(scenes) <= 18
    await orchestrator.confirm_storyboard(runtime, dispatcher, job.id)
    await dispatcher.drain()
    job = await reload(runtime, job.id)
    assert job.status == JobStatus.IN_REVIEW, job.error_message
    async with runtime.sessionmaker() as s:
        srt = await s.get(Asset, job.subtitle_asset_id)
        assert srt is not None
    text = runtime.storage.open_range(srt.storage_key)
    content = b"".join(text.body).decode()
    assert "-->" in content
    assert all(
        len(line) <= 16 for line in content.splitlines() if line and "-->" not in line and not line.isdigit()
    )


async def test_continuous_shots_chain_last_frame(
    runtime: Runtime, dispatcher: InlineDispatcher, templates: dict[str, Template], user: User
) -> None:
    job = await new_job(
        runtime, user, templates["marketing"], continuous_shots=True, audio_mode=AudioMode.NONE
    )
    await orchestrator.submit(runtime, dispatcher, job.id)
    await dispatcher.drain()
    await orchestrator.confirm_storyboard(runtime, dispatcher, job.id)
    # 連續鏡頭：一次只派發一個分鏡
    assert [k for k, _ in dispatcher.queue] == ["scene"]
    await dispatcher.drain()
    job = await reload(runtime, job.id)
    assert job.status == JobStatus.IN_REVIEW
    created = seedance(runtime).created
    assert len(created) >= 3
    assert all(any(i.role == "first_frame" for i in r.images) for r in created[1:])


# ---- 失敗、重做、續跑、取消 -----------------------------------------------------


async def test_moderation_failure_then_regenerate_scene(
    runtime: Runtime, dispatcher: InlineDispatcher, templates: dict[str, Template], user: User
) -> None:
    seedance(runtime).task_failures[2] = ("OutputVideoSensitiveContentDetected", "輸出內容未通過審核")
    job = await new_job(runtime, user, templates["marketing"], audio_mode=AudioMode.NONE)
    await orchestrator.submit(runtime, dispatcher, job.id)
    await dispatcher.drain()
    await orchestrator.confirm_storyboard(runtime, dispatcher, job.id)
    await dispatcher.drain()
    job = await reload(runtime, job.id)
    assert job.status == JobStatus.FAILED
    assert job.error_kind == "moderation"
    scenes = await scenes_of(runtime, job.id)
    failed = [s for s in scenes if s.status == SceneStatus.FAILED]
    assert len(failed) == 1 and failed[0].error_kind == "moderation"
    n_before = len(seedance(runtime).created)

    await orchestrator.regenerate_scene(runtime, dispatcher, job.id, failed[0].id, "video")
    await dispatcher.drain()
    job = await reload(runtime, job.id)
    assert job.status == JobStatus.IN_REVIEW
    assert len(seedance(runtime).created) == n_before + 1  # 只重做失敗的分鏡


async def test_budget_blocks_confirmation(
    runtime: Runtime, dispatcher: InlineDispatcher, templates: dict[str, Template], user: User
) -> None:
    job = await new_job(runtime, user, templates["marketing"])
    await orchestrator.submit(runtime, dispatcher, job.id)
    await dispatcher.drain()
    async with runtime.sessionmaker() as s:
        await s.execute(update(type(job)).where(type(job).id == job.id).values(budget_cny=0.01))
        await s.commit()
    with pytest.raises(ActionError, match="超出預算"):
        await orchestrator.confirm_storyboard(runtime, dispatcher, job.id)
    assert (await reload(runtime, job.id)).status == JobStatus.STORYBOARD_READY


async def test_budget_exceeded_mid_run_then_resume(
    runtime: Runtime, dispatcher: InlineDispatcher, templates: dict[str, Template], user: User
) -> None:
    job = await new_job(runtime, user, templates["marketing"], audio_mode=AudioMode.NONE)
    await orchestrator.submit(runtime, dispatcher, job.id)
    await dispatcher.drain()
    await orchestrator.confirm_storyboard(runtime, dispatcher, job.id)
    # 確認後才把預算壓低，模擬生成途中超支
    async with runtime.sessionmaker() as s:
        await s.execute(update(type(job)).where(type(job).id == job.id).values(budget_cny=0.02))
        await s.commit()
    await dispatcher.drain()
    job = await reload(runtime, job.id)
    assert job.status == JobStatus.BUDGET_EXCEEDED
    assert job.error_kind == "budget"

    async with runtime.sessionmaker() as s:
        await s.execute(update(type(job)).where(type(job).id == job.id).values(budget_cny=100))
        await s.commit()
    await orchestrator.resume(runtime, dispatcher, job.id)
    await dispatcher.drain()
    assert (await reload(runtime, job.id)).status == JobStatus.IN_REVIEW


async def test_cancel_stops_pending_scenes(
    runtime: Runtime,
    gateway: Gateway,
    dispatcher: InlineDispatcher,
    templates: dict[str, Template],
    user: User,
) -> None:
    job = await new_job(runtime, user, templates["marketing"], audio_mode=AudioMode.NONE)
    await orchestrator.submit(runtime, dispatcher, job.id)
    await dispatcher.drain()
    await orchestrator.confirm_storyboard(runtime, dispatcher, job.id)
    await orchestrator.cancel(runtime, gateway, dispatcher, job.id)
    await dispatcher.drain()
    job = await reload(runtime, job.id)
    assert job.status == JobStatus.CANCELLED
    assert seedance(runtime).created == []
    assert all(s.status == SceneStatus.CANCELLED for s in await scenes_of(runtime, job.id))
    with pytest.raises(ActionError):
        await orchestrator.resume(runtime, dispatcher, job.id)


async def test_draft_mode_then_render_final(
    runtime: Runtime, dispatcher: InlineDispatcher, templates: dict[str, Template], user: User
) -> None:
    job = await new_job(runtime, user, templates["quick"], draft_mode=True, topic="海浪拍打礁石")
    await orchestrator.submit(runtime, dispatcher, job.id)
    await dispatcher.drain()
    job = await reload(runtime, job.id)
    assert job.status == JobStatus.IN_REVIEW and job.phase == "draft"
    draft_req = seedance(runtime).created[0]
    assert draft_req.draft is True and draft_req.model_id == runtime.config.models.video_draft.id
    assert draft_req.resolution == "480p"
    await orchestrator.render_final(runtime, dispatcher, job.id)
    await dispatcher.drain()
    job = await reload(runtime, job.id)
    assert job.status == JobStatus.IN_REVIEW and job.phase == "final"
    final_req = seedance(runtime).created[-1]
    assert final_req.draft is False and final_req.model_id == runtime.config.models.video_final.id


async def test_advance_is_idempotent(
    runtime: Runtime, dispatcher: InlineDispatcher, templates: dict[str, Template], user: User
) -> None:
    job = await new_job(runtime, user, templates["marketing"], audio_mode=AudioMode.NONE)
    await orchestrator.submit(runtime, dispatcher, job.id)
    await dispatcher.drain()
    await orchestrator.confirm_storyboard(runtime, dispatcher, job.id)
    n = len(dispatcher.queue)
    await orchestrator.advance(runtime, dispatcher, job.id)
    await orchestrator.advance(runtime, dispatcher, job.id)
    assert len(dispatcher.queue) == n  # 已排隊的分鏡不會再派發


async def test_edit_storyboard_marks_regeneration(
    runtime: Runtime, dispatcher: InlineDispatcher, templates: dict[str, Template], user: User
) -> None:
    job = await new_job(runtime, user, templates["marketing"])
    await orchestrator.submit(runtime, dispatcher, job.id)
    await dispatcher.drain()
    async with runtime.sessionmaker() as s:
        j = await s.get(type(job), job.id)
        assert j is not None
        [scene] = (await s.scalars(select(Scene).where(Scene.job_id == job.id, Scene.index == 0))).all()
        await update_scene(s, j, scene, {"narration": "新的旁白", "duration_s": 6.0}, user)
        await s.commit()
    scenes = await scenes_of(runtime, job.id)
    assert scenes[0].narration == "新的旁白" and scenes[0].duration_s == 6.0


# ---- 腳本與內容檢查 -----------------------------------------------------------


async def test_storyboard_fix_round(
    runtime: Runtime, dispatcher: InlineDispatcher, templates: dict[str, Template], user: User
) -> None:
    llm = runtime.providers.llm
    assert isinstance(llm, MockLLM)
    too_many = {
        "title": "x",
        "scenes": [{"visual_prompt": f"畫面{i}", "duration_s": 3, "narration": "旁白"} for i in range(9)],
    }
    good = {
        "title": "x",
        "scenes": [{"visual_prompt": f"畫面{i}", "duration_s": 5, "narration": "旁白"} for i in range(4)],
    }
    llm.scripted.extend([too_many, good])
    job = await new_job(runtime, user, templates["marketing"])
    await orchestrator.submit(runtime, dispatcher, job.id)
    await dispatcher.drain()
    assert len(llm.calls) == 2
    assert "鏡頭數必須在" in llm.calls[1][-1].content
    assert len(await scenes_of(runtime, job.id)) == 4


async def test_normalize_storyboard_clamps(runtime: Runtime) -> None:
    caps = runtime.config.video_caps("video_final")
    rules = StoryboardRules(3, 6, 15, 30, 20, caps, narration_driven=False)
    scenes = [SceneDraft(visual_prompt="a", duration_s=40) for _ in range(8)]
    assert check_storyboard(scenes, rules)
    out = normalize_storyboard(scenes, rules)
    assert len(out) == 6
    assert all(caps.min_duration_s <= s.duration_s <= caps.max_duration_s for s in out)
    assert sum(s.duration_s for s in out) <= 30 + 6

    training = StoryboardRules(6, 18, 60, 180, 90, caps, narration_driven=True)
    long_text = "這是一段比較長的旁白" * 3
    [s] = normalize_storyboard([SceneDraft(visual_prompt="a", duration_s=2, narration=long_text)], training)
    assert s.duration_s >= 7


async def test_content_warnings(
    runtime: Runtime, dispatcher: InlineDispatcher, templates: dict[str, Template], user: User
) -> None:
    job = await new_job(runtime, user, templates["marketing"], topic="迪士尼風格的可口可樂廣告")
    await orchestrator.submit(runtime, dispatcher, job.id)
    await dispatcher.drain()
    job = await reload(runtime, job.id)
    assert any("影視或動漫 IP" in w for w in job.warnings)
    assert any("第三方品牌" in w for w in job.warnings)


async def test_blocklist_matching(runtime: Runtime) -> None:
    bl = load_blocklist(runtime.settings.content_blocklist_path)
    assert check_texts([("旁白", "穿著 NIKE 球鞋")], bl) == ["旁白可能包含第三方品牌：Nike"]
    assert check_texts([("旁白", "清晨的茶園")], bl) == []


# ---- 批量 ---------------------------------------------------------------------


async def test_batch_respects_max_parallel(
    runtime: Runtime, dispatcher: InlineDispatcher, templates: dict[str, Template], user: User
) -> None:
    async with runtime.sessionmaker() as s:
        batch = Batch(owner_id=user.id, template_id=templates["quick"].id, total=3, max_parallel=1)
        s.add(batch)
        await s.commit()
    for i in range(3):
        await new_job(runtime, user, templates["quick"], topic=f"商品{i}", batch_id=batch.id)
    dispatcher.batch(batch.id)
    await dispatcher.step()
    assert [k for k, _ in dispatcher.queue] == ["script"]  # 只提交 1 個
    await dispatcher.drain()
    async with runtime.sessionmaker() as s:
        from app.models import Job

        rows = (await s.scalars(select(Job.status).where(Job.batch_id == batch.id))).all()
        b = await s.get(Batch, batch.id)
        assert b is not None
    assert list(rows) == [JobStatus.IN_REVIEW] * 3
    assert b.status == "done"


async def test_daily_budget_setting_override(runtime: Runtime) -> None:
    async with runtime.sessionmaker() as s:
        b = await set_budget(s, runtime.config, per_job_cny=12, per_user_daily_cny=None)
        await s.commit()
    assert b.per_job_cny == 12 and b.per_user_daily_cny == runtime.config.budget.per_user_daily_cny
