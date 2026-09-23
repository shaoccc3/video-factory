"""任務：建立、查詢、分鏡編輯與確認、重做、取消、續跑、審核、調用記錄、SSE 進度推送。"""

import asyncio
import json
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select

from app.api.deps import (
    CreatorUser,
    CurrentUser,
    DispatcherDep,
    GatewayDep,
    ReviewerUser,
    RuntimeDep,
    SessionDep,
)
from app.api.schemas import (
    CostEstimateOut,
    GenerationCallOut,
    JobCreate,
    JobDetail,
    JobSummary,
    Page,
    RegenerateIn,
    ReviewIn,
    SceneUpdate,
)
from app.api.serializers import estimate_out, job_detail, job_summaries
from app.models import CostLedger, GenerationCall, Job, Review, Scene, User
from app.models.enums import REVIEW_CHECKLIST_KEYS, JobPhase, JobStatus, ReviewDecision, Role, VideoType
from app.pipeline import orchestrator
from app.pipeline.common import video_model_key
from app.pipeline.estimate import estimate_job
from app.pipeline.orchestrator import ActionError
from app.pipeline.state import transition
from app.services.audit import audit
from app.services.jobs import JobInput, can_view, create_job, is_owner, update_scene
from app.services.runtime import Runtime

router = APIRouter(prefix="/jobs", tags=["jobs"])
SSE_POLL_S = 1.5
SSE_PING_S = 15.0


def _http(exc: ActionError) -> HTTPException:
    return HTTPException(exc.status, str(exc))


async def _load(session: SessionDep, job_id: uuid.UUID, user: User, *, manage: bool = False) -> Job:
    job = await session.get(Job, job_id)
    if job is None or not can_view(job, user):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "任務不存在")
    if manage and not (is_owner(job, user) or Role.ADMIN in user.roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "只有任務建立者或管理員可以操作")
    return job


async def _detail(session: SessionDep, runtime: Runtime, job_id: uuid.UUID, user: User) -> JobDetail:
    """用新的會話讀取最新狀態（編排器在其他會話裡改過任務與分鏡）。"""
    async with runtime.sessionmaker() as fresh:
        viewer = await fresh.get(User, user.id)
        if viewer is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "請先登入")
        job = await _load(fresh, job_id, viewer)
        return await job_detail(fresh, runtime, job, viewer)


@router.post("", response_model=JobDetail, status_code=status.HTTP_201_CREATED)
async def create(
    body: JobCreate, user: CreatorUser, session: SessionDep, runtime: RuntimeDep, request: Request
) -> JobDetail:
    try:
        job = await create_job(
            session,
            runtime.config,
            runtime.settings.ark_region,
            user,
            JobInput(
                template_id=body.template_id,
                title=body.title,
                topic=body.inputs.topic,
                extra=body.inputs.extra,
                target_duration_s=body.target_duration_s,
                audio_mode=body.audio_mode,
                ratio=body.ratio,
                draft_mode=body.draft_mode,
                continuous_shots=body.continuous_shots,
                product_asset_ids=body.product_asset_ids,
                logo_asset_id=body.logo_asset_id,
                bgm_asset_id=body.bgm_asset_id,
                image_asset_id=body.image_asset_id,
                voice_style=body.voice_style,
                music=body.music,
                consistent_voice=body.consistent_voice,
            ),
        )
    except ActionError as exc:
        raise _http(exc) from exc
    audit(
        session,
        request,
        user.id,
        "job_create",
        target_type="job",
        target_id=job.id,
        template=job.template_snapshot.get("key"),
    )
    await session.commit()
    return await job_detail(session, runtime, job, user)


@router.get("", response_model=Page[JobSummary])
async def list_jobs(
    user: CurrentUser,
    session: SessionDep,
    status_: JobStatus | None = Query(default=None, alias="status"),
    video_type: VideoType | None = None,
    mine: bool = False,
    q: str | None = Query(default=None, max_length=100),
    batch_id: uuid.UUID | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> Page[JobSummary]:
    query = select(Job)
    if mine or not ({Role.ADMIN, Role.REVIEWER} & set(user.roles)):
        query = query.where(Job.owner_id == user.id)
    if status_ is not None:
        query = query.where(Job.status == status_.value)
    if video_type is not None:
        query = query.where(Job.video_type == video_type.value)
    if batch_id is not None:
        query = query.where(Job.batch_id == batch_id)
    if q:
        like = f"%{q.strip()}%"
        query = query.where(or_(Job.title.ilike(like), Job.inputs["topic"].as_string().ilike(like)))
    total = int(await session.scalar(select(func.count()).select_from(query.subquery())) or 0)
    jobs = (
        await session.scalars(
            query.order_by(Job.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
        )
    ).all()
    return Page(items=await job_summaries(session, jobs), total=total)


@router.get("/{job_id}", response_model=JobDetail)
async def get_job(
    job_id: uuid.UUID, user: CurrentUser, session: SessionDep, runtime: RuntimeDep
) -> JobDetail:
    return await _detail(session, runtime, job_id, user)


@router.post("/{job_id}/submit", response_model=JobDetail)
async def submit(
    job_id: uuid.UUID,
    user: CurrentUser,
    session: SessionDep,
    runtime: RuntimeDep,
    dispatcher: DispatcherDep,
    request: Request,
) -> JobDetail:
    await _load(session, job_id, user, manage=True)
    try:
        await orchestrator.submit(runtime, dispatcher, job_id)
    except ActionError as exc:
        raise _http(exc) from exc
    audit(session, request, user.id, "job_submit", target_type="job", target_id=job_id)
    await session.commit()
    return await _detail(session, runtime, job_id, user)


@router.post("/{job_id}/regenerate-script", response_model=JobDetail)
async def regenerate_script(
    job_id: uuid.UUID, user: CurrentUser, session: SessionDep, runtime: RuntimeDep, dispatcher: DispatcherDep
) -> JobDetail:
    await _load(session, job_id, user, manage=True)
    try:
        await orchestrator.regenerate_script(runtime, dispatcher, job_id)
    except ActionError as exc:
        raise _http(exc) from exc
    return await _detail(session, runtime, job_id, user)


@router.patch("/{job_id}/scenes/{scene_id}", response_model=JobDetail)
async def patch_scene(
    job_id: uuid.UUID,
    scene_id: uuid.UUID,
    body: SceneUpdate,
    user: CurrentUser,
    session: SessionDep,
    runtime: RuntimeDep,
) -> JobDetail:
    job = await _load(session, job_id, user, manage=True)
    scene = await session.get(Scene, scene_id)
    if scene is None or scene.job_id != job.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "分鏡不存在")
    changes = body.model_dump(exclude_unset=True)
    for required in ("visual_prompt", "duration_s"):
        if required in changes and changes[required] is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"{required} 不能為空")
    if changes.get("duration_s") is not None:
        caps = runtime.config.video_caps(video_model_key(job, runtime.config))
        if not caps.min_duration_s <= float(changes["duration_s"]) <= caps.max_duration_s:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"鏡頭時長必須在 {caps.min_duration_s}～{caps.max_duration_s} 秒之間（模型能力表）",
            )
    try:
        await update_scene(session, job, scene, changes, user)
    except ActionError as exc:
        raise _http(exc) from exc
    scenes = list((await session.scalars(select(Scene).where(Scene.job_id == job.id))).all())
    owner = await session.get(User, job.owner_id)
    if owner is not None:
        job.estimated_cost_cny = (await estimate_job(session, runtime.config, job, scenes, owner)).total_cny
    await session.commit()
    return await _detail(session, runtime, job_id, user)


@router.get("/{job_id}/estimate", response_model=CostEstimateOut)
async def estimate(
    job_id: uuid.UUID, user: CurrentUser, session: SessionDep, runtime: RuntimeDep
) -> CostEstimateOut:
    job = await _load(session, job_id, user)
    scenes = list((await session.scalars(select(Scene).where(Scene.job_id == job.id))).all())
    owner = await session.get(User, job.owner_id)
    if owner is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "任務擁有者不存在")
    return estimate_out(await estimate_job(session, runtime.config, job, scenes, owner))


@router.post("/{job_id}/confirm-storyboard", response_model=JobDetail)
async def confirm(
    job_id: uuid.UUID,
    user: CurrentUser,
    session: SessionDep,
    runtime: RuntimeDep,
    dispatcher: DispatcherDep,
    request: Request,
) -> JobDetail:
    await _load(session, job_id, user, manage=True)
    try:
        await orchestrator.confirm_storyboard(runtime, dispatcher, job_id)
    except ActionError as exc:
        raise _http(exc) from exc
    audit(session, request, user.id, "job_confirm", target_type="job", target_id=job_id)
    await session.commit()
    return await _detail(session, runtime, job_id, user)


@router.post("/{job_id}/scenes/{scene_id}/regenerate", response_model=JobDetail)
async def regenerate_scene(
    job_id: uuid.UUID,
    scene_id: uuid.UUID,
    body: RegenerateIn,
    user: CurrentUser,
    session: SessionDep,
    runtime: RuntimeDep,
    dispatcher: DispatcherDep,
) -> JobDetail:
    await _load(session, job_id, user, manage=True)
    try:
        await orchestrator.regenerate_scene(runtime, dispatcher, job_id, scene_id, body.target)
    except ActionError as exc:
        raise _http(exc) from exc
    return await _detail(session, runtime, job_id, user)


@router.post("/{job_id}/render-final", response_model=JobDetail)
async def render_final(
    job_id: uuid.UUID, user: CurrentUser, session: SessionDep, runtime: RuntimeDep, dispatcher: DispatcherDep
) -> JobDetail:
    await _load(session, job_id, user, manage=True)
    try:
        await orchestrator.render_final(runtime, dispatcher, job_id)
    except ActionError as exc:
        raise _http(exc) from exc
    return await _detail(session, runtime, job_id, user)


@router.post("/{job_id}/cancel", response_model=JobDetail)
async def cancel(
    job_id: uuid.UUID,
    user: CurrentUser,
    session: SessionDep,
    runtime: RuntimeDep,
    dispatcher: DispatcherDep,
    gateway: GatewayDep,
    request: Request,
) -> JobDetail:
    await _load(session, job_id, user, manage=True)
    try:
        await orchestrator.cancel(runtime, gateway, dispatcher, job_id)
    except ActionError as exc:
        raise _http(exc) from exc
    audit(session, request, user.id, "job_cancel", target_type="job", target_id=job_id)
    await session.commit()
    return await _detail(session, runtime, job_id, user)


@router.post("/{job_id}/resume", response_model=JobDetail)
async def resume(
    job_id: uuid.UUID, user: CurrentUser, session: SessionDep, runtime: RuntimeDep, dispatcher: DispatcherDep
) -> JobDetail:
    await _load(session, job_id, user, manage=True)
    try:
        await orchestrator.resume(runtime, dispatcher, job_id)
    except ActionError as exc:
        raise _http(exc) from exc
    return await _detail(session, runtime, job_id, user)


@router.post("/{job_id}/review", response_model=JobDetail)
async def review(
    job_id: uuid.UUID,
    body: ReviewIn,
    user: ReviewerUser,
    session: SessionDep,
    runtime: RuntimeDep,
    request: Request,
) -> JobDetail:
    job = await _load(session, job_id, user)
    if job.status != JobStatus.IN_REVIEW or job.phase != JobPhase.FINAL:
        raise HTTPException(status.HTTP_409_CONFLICT, "只有待審核的正片可以審核")
    checklist = {key: bool(body.checklist.get(key, False)) for key in REVIEW_CHECKLIST_KEYS}
    reason = body.reason.strip()
    if body.decision == ReviewDecision.APPROVED:
        if not all(checklist.values()):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "審核通過需要勾選全部檢查項")
        target = JobStatus.APPROVED
    else:
        if not reason:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "退回必須填寫原因")
        target = JobStatus.REJECTED
    ok = await transition(session, job.id, target, from_statuses=[JobStatus.IN_REVIEW])
    if not ok:
        raise HTTPException(status.HTTP_409_CONFLICT, "任務狀態已變化，請重新整理")
    session.add(
        Review(
            job_id=job.id,
            reviewer_id=user.id,
            decision=body.decision.value,
            checklist=checklist,
            reason=reason,
        )
    )
    audit(
        session,
        request,
        user.id,
        "job_review",
        target_type="job",
        target_id=job.id,
        decision=body.decision.value,
    )
    await session.commit()
    return await _detail(session, runtime, job_id, user)


@router.get("/{job_id}/calls", response_model=list[GenerationCallOut])
async def calls(job_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> list[GenerationCallOut]:
    await _load(session, job_id, user)
    rows = await session.execute(
        select(GenerationCall, func.coalesce(func.sum(CostLedger.amount_cny), 0))
        .outerjoin(CostLedger, CostLedger.generation_call_id == GenerationCall.id)
        .where(GenerationCall.job_id == job_id)
        .group_by(GenerationCall.id)
        .order_by(GenerationCall.started_at)
    )
    out = []
    for call, cost in rows.all():
        duration = None
        if call.finished_at is not None:
            duration = int((call.finished_at - call.started_at).total_seconds() * 1000)
        out.append(
            GenerationCallOut(
                id=call.id,
                scene_id=call.scene_id,
                provider=call.provider,
                model_id=call.model_id,
                remote_task_id=call.remote_task_id,
                status=call.status,
                error_kind=call.error_kind,
                error_code=call.error_code,
                attempt=call.attempt,
                started_at=call.started_at,
                finished_at=call.finished_at,
                duration_ms=duration,
                cost_cny=round(float(cost), 4),
            )
        )
    return out


async def job_event_stream(
    runtime: Runtime,
    job_id: uuid.UUID,
    user: User,
    is_disconnected: Callable[[], Awaitable[bool]],
    *,
    poll_s: float = SSE_POLL_S,
    ping_s: float = SSE_PING_S,
) -> AsyncIterator[str]:
    """任務或分鏡有變化時推送完整 JobDetail；沒有變化時定期發 ping 保持連線。"""
    last = ""
    idle = 0.0
    while not await is_disconnected():
        async with runtime.sessionmaker() as s:
            job = await s.get(Job, job_id)
            viewer = await s.get(User, user.id)
            if job is None or viewer is None or not viewer.is_active:
                return
            detail = await job_detail(s, runtime, job, viewer)
        fingerprint = json.dumps(
            [
                detail.status,
                detail.updated_at.isoformat(),
                [
                    (sc.status, sc.attempt, str(sc.video_asset_id), str(sc.audio_asset_id))
                    for sc in detail.scenes
                ],
                detail.actual_cost_cny,
            ]
        )
        if fingerprint != last:
            last = fingerprint
            idle = 0.0
            yield f"event: job\ndata: {detail.model_dump_json()}\n\n"
        elif idle >= ping_s:
            idle = 0.0
            yield ": ping\n\n"
        await asyncio.sleep(poll_s)
        idle += poll_s


@router.get("/{job_id}/events")
async def events(
    job_id: uuid.UUID, user: CurrentUser, session: SessionDep, runtime: RuntimeDep, request: Request
) -> StreamingResponse:
    """SSE：`event: job`，data 為 JobDetail。"""
    await _load(session, job_id, user)
    return StreamingResponse(
        job_event_stream(runtime, job_id, user, request.is_disconnected),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
