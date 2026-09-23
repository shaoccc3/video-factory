"""流水線編排（P10）。

事件驅動：每個步驟結束都調用 advance()，按當前狀態決定下一步；狀態轉換用條件更新保證只發生一次。
- scripting：一個任務（run_scripting）
- generating：每個分鏡一個任務；連續鏡頭時串行（用上一段尾幀作首幀），否則並行（受模型並發上限約束）
- composing：配音、字幕、合成一個任務
每個步驟冪等：已成功的分鏡不重做；已建立的 Seedance 任務續跑時沿用遠端任務 id。
"""

import uuid
from typing import Protocol

import structlog
from sqlalchemy import func, select, update

from app.models import Batch, Job, Scene, User
from app.models.enums import ErrorKind, JobPhase, JobStatus, SceneStatus, VideoType
from app.pipeline.common import job_options, voice_reference_usable
from app.pipeline.composing import compose_job
from app.pipeline.estimate import estimate_job
from app.pipeline.generation import generate_scene_video
from app.pipeline.scripting import run_scripting
from app.pipeline.state import ACTIVE, transition
from app.providers.errors import BudgetExceededError, ProviderError
from app.providers.gateway import Gateway, JobCancelledError
from app.services.assets import AssetUrlError
from app.services.runtime import Runtime

log = structlog.get_logger(__name__)

IN_FLIGHT = (SceneStatus.QUEUED, SceneStatus.KEYFRAME, SceneStatus.RUNNING)
RESTING = frozenset(
    {
        JobStatus.STORYBOARD_READY,
        JobStatus.IN_REVIEW,
        JobStatus.APPROVED,
        JobStatus.REJECTED,
        JobStatus.FAILED,
        JobStatus.CANCELLED,
        JobStatus.BUDGET_EXCEEDED,
    }
)


class Dispatcher(Protocol):
    """把步驟丟給 worker。Celery 實現見 app/workers/dispatch.py，測試用 InlineDispatcher。"""

    def script(self, job_id: uuid.UUID) -> None: ...
    def scene(self, job_id: uuid.UUID, scene_id: uuid.UUID) -> None: ...
    def compose(self, job_id: uuid.UUID) -> None: ...
    def batch(self, batch_id: uuid.UUID) -> None: ...


class ActionError(Exception):
    """用戶操作不合法（例如狀態不對）。status 對應 HTTP 狀態碼。"""

    def __init__(self, message: str, status: int = 409) -> None:
        super().__init__(message)
        self.status = status


def _error_values(exc: BaseException) -> dict[str, object]:
    if isinstance(exc, ProviderError):
        return {"error_kind": exc.kind.value, "error_code": exc.code, "error_message": str(exc)[:500]}
    if isinstance(exc, BudgetExceededError):
        return {
            "error_kind": ErrorKind.BUDGET.value,
            "error_code": f"budget_{exc.scope}",
            "error_message": str(exc),
        }
    if isinstance(exc, AssetUrlError):
        return {"error_kind": ErrorKind.CLIENT.value, "error_code": "asset_url", "error_message": str(exc)}
    return {
        "error_kind": ErrorKind.INTERNAL.value,
        "error_code": type(exc).__name__,
        "error_message": "系統內部錯誤，請稍後重試或聯繫管理員",
    }


async def _notify_batch(runtime: Runtime, dispatcher: Dispatcher, job_id: uuid.UUID) -> None:
    async with runtime.sessionmaker() as session:
        batch_id = await session.scalar(select(Job.batch_id).where(Job.id == job_id))
    if batch_id is not None:
        dispatcher.batch(batch_id)


# ---- 提交與腳本 ---------------------------------------------------------------


async def submit(runtime: Runtime, dispatcher: Dispatcher, job_id: uuid.UUID) -> None:
    async with runtime.sessionmaker() as session:
        ok = await transition(
            session, job_id, JobStatus.SCRIPTING, from_statuses=[JobStatus.DRAFT],
            error_kind=None, error_code=None, error_message=None,
        )  # fmt: skip
        await session.commit()
    if not ok:
        raise ActionError("只有草稿狀態可以提交")
    dispatcher.script(job_id)


async def regenerate_script(runtime: Runtime, dispatcher: Dispatcher, job_id: uuid.UUID) -> None:
    async with runtime.sessionmaker() as session:
        ok = await transition(
            session,
            job_id,
            JobStatus.SCRIPTING,
            from_statuses=[
                JobStatus.STORYBOARD_READY,
                JobStatus.REJECTED,
                JobStatus.FAILED,
                JobStatus.BUDGET_EXCEEDED,
            ],
            final_asset_id=None,
            cover_asset_id=None,
            subtitle_asset_id=None,
            error_kind=None,
            error_code=None,
            error_message=None,
        )
        await session.commit()
    if not ok:
        raise ActionError("目前狀態不能重新生成腳本")
    dispatcher.script(job_id)


async def task_script(runtime: Runtime, gateway: Gateway, dispatcher: Dispatcher, job_id: uuid.UUID) -> None:
    try:
        await run_scripting(runtime, gateway, job_id)
    except BudgetExceededError as exc:
        await _fail(runtime, job_id, JobStatus.BUDGET_EXCEEDED, exc, [JobStatus.SCRIPTING])
    except Exception as exc:
        log.exception("scripting_failed", job_id=str(job_id))
        await _fail(runtime, job_id, JobStatus.FAILED, exc, [JobStatus.SCRIPTING])
    else:
        async with runtime.sessionmaker() as session:
            job = await session.get(Job, job_id)
            auto = (
                job is not None
                and job.video_type == VideoType.QUICK
                and job.status == JobStatus.STORYBOARD_READY
            )
        if auto:
            try:
                await confirm_storyboard(runtime, dispatcher, job_id)
            except ActionError as exc:  # 超預算時停在分鏡確認，由用戶處理
                log.info("quick_auto_confirm_skipped", job_id=str(job_id), reason=str(exc))
    await _notify_batch(runtime, dispatcher, job_id)


async def _fail(
    runtime: Runtime, job_id: uuid.UUID, target: JobStatus, exc: BaseException, sources: list[JobStatus]
) -> None:
    async with runtime.sessionmaker() as session:
        await transition(session, job_id, target, from_statuses=sources, **_error_values(exc))
        await session.commit()


# ---- 分鏡確認與生成 -----------------------------------------------------------


async def confirm_storyboard(runtime: Runtime, dispatcher: Dispatcher, job_id: uuid.UUID) -> None:
    """確認分鏡：預估不超預算才進入 generating。"""
    async with runtime.sessionmaker() as session:
        job = await session.get(Job, job_id)
        if job is None:
            raise ActionError("任務不存在", 404)
        if job.status not in (JobStatus.STORYBOARD_READY, JobStatus.REJECTED):
            raise ActionError("目前狀態不能確認分鏡")
        scenes = list((await session.scalars(select(Scene).where(Scene.job_id == job.id))).all())
        if not scenes:
            raise ActionError("沒有分鏡")
        owner = await session.get(User, job.owner_id)
        if owner is None:
            raise ActionError("任務擁有者不存在", 404)
        estimate = await estimate_job(session, runtime.config, job, scenes, owner)
        if not estimate.within_budget:
            raise ActionError(
                f"預估 {estimate.total_cny:.2f} 元超出預算（單任務上限 {estimate.budget_per_job_cny:.2f}、"
                f"今日已用 {estimate.spent_today_cny:.2f}／{estimate.daily_budget_cny:.2f}）"
            )
        await session.execute(
            update(Scene)
            .where(Scene.job_id == job.id, Scene.status.not_in([SceneStatus.SUCCEEDED.value]))
            .values(status=SceneStatus.PENDING.value, error_kind=None, error_message=None)
        )
        ok = await transition(
            session, job.id, JobStatus.GENERATING, from_statuses=[JobStatus.STORYBOARD_READY, JobStatus.REJECTED],
            estimated_cost_cny=estimate.total_cny, final_asset_id=None, cover_asset_id=None, subtitle_asset_id=None,
        )  # fmt: skip
        await session.commit()
    if not ok:
        raise ActionError("任務狀態已變化，請重新整理")
    await advance(runtime, dispatcher, job_id)


async def advance(runtime: Runtime, dispatcher: Dispatcher, job_id: uuid.UUID) -> None:
    """generating 狀態下：派發可執行的分鏡；全部成功則進入 composing；有失敗且無進行中則任務失敗。"""
    to_dispatch: list[uuid.UUID] = []
    compose = False
    async with runtime.sessionmaker() as session:
        job = await session.get(Job, job_id)
        if job is None or job.status != JobStatus.GENERATING:
            return
        scenes = list(
            (await session.scalars(select(Scene).where(Scene.job_id == job.id).order_by(Scene.index))).all()
        )
        in_flight = [s for s in scenes if s.status in IN_FLIGHT]
        failed = [s for s in scenes if s.status == SceneStatus.FAILED]
        pending = [s for s in scenes if s.status == SceneStatus.PENDING]
        if failed and not in_flight:
            first = failed[0]
            await transition(
                session, job.id, JobStatus.FAILED, from_statuses=[JobStatus.GENERATING],
                error_kind=first.error_kind, error_code="scene_failed",
                error_message=f"第 {first.index + 1} 鏡失敗：{first.error_message or ''}",
            )  # fmt: skip
            await session.commit()
            await _notify_batch(runtime, dispatcher, job_id)
            return
        if not failed and scenes and all(s.status == SceneStatus.SUCCEEDED for s in scenes):
            compose = await transition(
                session, job.id, JobStatus.COMPOSING, from_statuses=[JobStatus.GENERATING]
            )
        elif pending and not failed:
            opts = job_options(job)
            first = scenes[0]
            if opts.continuous_shots:
                nxt = pending[0]
                earlier_ok = all(s.status == SceneStatus.SUCCEEDED for s in scenes if s.index < nxt.index)
                candidates = [nxt] if earlier_ok and not in_flight else []
            elif (
                opts.consistent_voice
                and first.status != SceneStatus.SUCCEEDED
                and voice_reference_usable(runtime.config, job, scenes)
            ):
                # 聲音一致：第一鏡的聲音是後續鏡頭的參考音頻，先只做第一鏡；模型用不上參考音頻時不必等
                candidates = [first] if first.status == SceneStatus.PENDING else []
            else:
                candidates = pending
            for scene in candidates:
                claimed = await session.execute(
                    update(Scene)
                    .where(Scene.id == scene.id, Scene.status == SceneStatus.PENDING.value)
                    .values(status=SceneStatus.QUEUED.value, attempt=Scene.attempt + 1)
                    .execution_options(synchronize_session=False)
                )
                if claimed.rowcount:  # type: ignore[attr-defined]
                    to_dispatch.append(scene.id)
        await session.commit()
    for scene_id in to_dispatch:
        dispatcher.scene(job_id, scene_id)
    if compose:
        dispatcher.compose(job_id)


async def task_scene(
    runtime: Runtime, gateway: Gateway, dispatcher: Dispatcher, job_id: uuid.UUID, scene_id: uuid.UUID
) -> None:
    try:
        await generate_scene_video(runtime, gateway, job_id, scene_id)
    except JobCancelledError:
        await _set_scene_status(runtime, scene_id, SceneStatus.CANCELLED, None)
    except BudgetExceededError as exc:
        await _set_scene_status(runtime, scene_id, SceneStatus.PENDING, exc)
        await _fail(runtime, job_id, JobStatus.BUDGET_EXCEEDED, exc, [JobStatus.GENERATING])
        await _notify_batch(runtime, dispatcher, job_id)
    except Exception as exc:
        if not isinstance(exc, ProviderError):
            log.exception("scene_failed", job_id=str(job_id), scene_id=str(scene_id))
        await _set_scene_status(runtime, scene_id, SceneStatus.FAILED, exc)
    await advance(runtime, dispatcher, job_id)


async def _set_scene_status(
    runtime: Runtime, scene_id: uuid.UUID, status: SceneStatus, exc: BaseException | None
) -> None:
    values: dict[str, object] = {"status": status.value}
    if exc is not None:
        err = _error_values(exc)
        values["error_kind"] = err["error_kind"]
        values["error_message"] = err["error_message"]
    if status == SceneStatus.PENDING:
        values["remote_task_id"] = None
    async with runtime.sessionmaker() as session:
        await session.execute(update(Scene).where(Scene.id == scene_id).values(**values))
        await session.commit()


async def task_compose(runtime: Runtime, gateway: Gateway, dispatcher: Dispatcher, job_id: uuid.UUID) -> None:
    try:
        await compose_job(runtime, gateway, job_id)
    except BudgetExceededError as exc:
        await _fail(runtime, job_id, JobStatus.BUDGET_EXCEEDED, exc, [JobStatus.COMPOSING])
    except Exception as exc:
        log.exception("compose_failed", job_id=str(job_id))
        await _fail(runtime, job_id, JobStatus.FAILED, exc, [JobStatus.COMPOSING])
    await _notify_batch(runtime, dispatcher, job_id)


# ---- 用戶操作 -----------------------------------------------------------------


async def cancel(runtime: Runtime, gateway: Gateway, dispatcher: Dispatcher, job_id: uuid.UUID) -> None:
    remote: list[str] = []
    async with runtime.sessionmaker() as session:
        job = await session.get(Job, job_id)
        if job is None:
            raise ActionError("任務不存在", 404)
        ok = await transition(session, job_id, JobStatus.CANCELLED)
        if not ok:
            raise ActionError("目前狀態不能取消")
        rows = await session.scalars(
            select(Scene.remote_task_id).where(
                Scene.job_id == job_id,
                Scene.status.in_([s.value for s in IN_FLIGHT]),
                Scene.remote_task_id.is_not(None),
            )
        )
        remote = [r for r in rows if r]
        await session.execute(
            update(Scene)
            .where(
                Scene.job_id == job_id,
                Scene.status.in_([SceneStatus.PENDING.value, *[s.value for s in IN_FLIGHT]]),
            )
            .values(status=SceneStatus.CANCELLED.value)
        )
        await session.commit()
    for task_id in remote:
        await gateway.cancel_video(task_id)
    await _notify_batch(runtime, dispatcher, job_id)


async def resume(runtime: Runtime, dispatcher: Dispatcher, job_id: uuid.UUID) -> None:
    """從失敗點續跑：沒有分鏡就重跑腳本；分鏡都成功就重新合成；否則只重做未成功的分鏡。"""
    async with runtime.sessionmaker() as session:
        job = await session.get(Job, job_id)
        if job is None:
            raise ActionError("任務不存在", 404)
        if job.status not in (JobStatus.FAILED, JobStatus.BUDGET_EXCEEDED):
            raise ActionError("只有失敗或超預算的任務可以續跑")
        scenes = list((await session.scalars(select(Scene).where(Scene.job_id == job.id))).all())
        clear = {"error_kind": None, "error_code": None, "error_message": None}
        if not scenes:
            target = JobStatus.SCRIPTING
        elif all(s.status == SceneStatus.SUCCEEDED for s in scenes):
            target = JobStatus.COMPOSING
        else:
            target = JobStatus.GENERATING
            await session.execute(
                update(Scene)
                .where(Scene.job_id == job.id, Scene.status != SceneStatus.SUCCEEDED.value)
                .values(status=SceneStatus.PENDING.value, error_kind=None, error_message=None)
            )
        ok = await transition(
            session, job.id, target, from_statuses=[JobStatus.FAILED, JobStatus.BUDGET_EXCEEDED], **clear
        )
        await session.commit()
    if not ok:
        raise ActionError("任務狀態已變化，請重新整理")
    if target == JobStatus.SCRIPTING:
        dispatcher.script(job_id)
    elif target == JobStatus.COMPOSING:
        dispatcher.compose(job_id)
    else:
        await advance(runtime, dispatcher, job_id)


REGEN_SOURCES = (
    JobStatus.IN_REVIEW,
    JobStatus.REJECTED,
    JobStatus.FAILED,
    JobStatus.BUDGET_EXCEEDED,
    JobStatus.GENERATING,
)


async def regenerate_scene(
    runtime: Runtime, dispatcher: Dispatcher, job_id: uuid.UUID, scene_id: uuid.UUID, target: str
) -> None:
    """單分鏡重做：keyframe 重新生成首幀並重做影片；video 只重做影片。"""
    async with runtime.sessionmaker() as session:
        job = await session.get(Job, job_id)
        scene = await session.get(Scene, scene_id)
        if job is None or scene is None or scene.job_id != job.id:
            raise ActionError("分鏡不存在", 404)
        if job.status not in REGEN_SOURCES:
            raise ActionError("目前狀態不能重做分鏡")
        if scene.status in IN_FLIGHT:
            raise ActionError("這個分鏡正在生成中")
        values: dict[str, object] = {
            "status": SceneStatus.PENDING.value, "video_asset_id": None, "last_frame_asset_id": None,
            "remote_task_id": None, "error_kind": None, "error_message": None,
        }  # fmt: skip
        if target == "keyframe":
            if not scene.needs_first_frame and not scene.first_frame_generated:
                raise ActionError("這個分鏡沒有生成的首幀")
            values.update(first_frame_asset_id=None, needs_first_frame=True, first_frame_generated=False)
        await session.execute(update(Scene).where(Scene.id == scene.id).values(**values))
        if job.status != JobStatus.GENERATING:
            await transition(
                session, job.id, JobStatus.GENERATING, from_statuses=list(REGEN_SOURCES),
                final_asset_id=None, cover_asset_id=None, subtitle_asset_id=None,
                error_kind=None, error_code=None, error_message=None,
            )  # fmt: skip
        await session.commit()
    await advance(runtime, dispatcher, job_id)


async def render_final(runtime: Runtime, dispatcher: Dispatcher, job_id: uuid.UUID) -> None:
    """樣片確認後出正片：所有分鏡用正片模型重新生成。"""
    async with runtime.sessionmaker() as session:
        job = await session.get(Job, job_id)
        if job is None:
            raise ActionError("任務不存在", 404)
        if job.phase != JobPhase.DRAFT or job.status not in (JobStatus.IN_REVIEW, JobStatus.REJECTED):
            raise ActionError("只有樣片完成後可以出正片")
        await session.execute(
            update(Scene)
            .where(Scene.job_id == job.id)
            .values(
                status=SceneStatus.PENDING.value,
                video_asset_id=None,
                last_frame_asset_id=None,
                remote_task_id=None,
            )
        )
        ok = await transition(
            session, job.id, JobStatus.GENERATING, from_statuses=[JobStatus.IN_REVIEW, JobStatus.REJECTED],
            phase=JobPhase.FINAL.value, final_asset_id=None, cover_asset_id=None, subtitle_asset_id=None,
        )  # fmt: skip
        await session.commit()
    if not ok:
        raise ActionError("任務狀態已變化，請重新整理")
    await advance(runtime, dispatcher, job_id)


# ---- 批量 ---------------------------------------------------------------------


async def task_batch(runtime: Runtime, dispatcher: Dispatcher, batch_id: uuid.UUID) -> None:
    """按 max_parallel 提交批量中的草稿任務；全部結束後標記 done。"""
    to_submit: list[uuid.UUID] = []
    async with runtime.sessionmaker() as session:
        batch = await session.get(Batch, batch_id)
        if batch is None:
            return
        running = await session.scalar(
            select(func.count()).where(Job.batch_id == batch_id, Job.status.in_([s.value for s in ACTIVE]))
        )
        free = max(0, batch.max_parallel - int(running or 0))
        drafts = list(
            (
                await session.scalars(
                    select(Job.id)
                    .where(Job.batch_id == batch_id, Job.status == JobStatus.DRAFT.value)
                    .order_by(Job.created_at)
                    .limit(free)
                )
            ).all()
        )
        to_submit = drafts
        remaining = await session.scalar(
            select(func.count()).where(
                Job.batch_id == batch_id,
                Job.status.in_([JobStatus.DRAFT.value, *[s.value for s in ACTIVE]]),
            )
        )
        if not remaining and batch.status != "done":
            batch.status = "done"
        await session.commit()
    for job_id in to_submit:
        try:
            await submit(runtime, dispatcher, job_id)
        except ActionError:
            continue
