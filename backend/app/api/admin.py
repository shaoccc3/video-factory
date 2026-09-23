"""審核隊列、用量看板、模型與預算配置、審計日誌。"""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Query, Request
from sqlalchemy import func, select

from app.api.deps import AdminUser, CurrentUser, ReviewerUser, RuntimeDep, SessionDep
from app.api.schemas import (
    AuditLogOut,
    BudgetOut,
    BudgetUpdate,
    JobSummary,
    ModelsConfigOut,
    Page,
    UsageByDay,
    UsageByModel,
    UsageByUser,
    UsageSummary,
)
from app.api.serializers import job_summaries
from app.models import AuditLog, CostLedger, GenerationCall, Job, User
from app.models.enums import JobPhase, JobStatus, Role
from app.services.audit import audit
from app.services.budget import limits_for, spent_today
from app.services.settings_store import get_budget, set_budget

router = APIRouter(tags=["admin"])


@router.get("/reviews/queue", response_model=list[JobSummary])
async def review_queue(_: ReviewerUser, session: SessionDep) -> list[JobSummary]:
    jobs = (
        await session.scalars(
            select(Job)
            .where(Job.status == JobStatus.IN_REVIEW.value, Job.phase == JobPhase.FINAL.value)
            .order_by(Job.updated_at)
        )
    ).all()
    return await job_summaries(session, jobs)


@router.get("/usage/summary", response_model=UsageSummary)
async def usage_summary(
    user: CurrentUser, session: SessionDep, runtime: RuntimeDep, days: int = Query(default=30, ge=1, le=366)
) -> UsageSummary:
    since = datetime.now(UTC) - timedelta(days=days)
    base = select(CostLedger).where(CostLedger.created_at >= since)
    if not ({Role.ADMIN, Role.REVIEWER} & set(user.roles)):
        base = base.where(CostLedger.user_id == user.id)
    sub = base.subquery()
    total = float(await session.scalar(select(func.coalesce(func.sum(sub.c.amount_cny), 0))) or 0)
    by_user_rows = await session.execute(
        select(sub.c.user_id, func.sum(sub.c.amount_cny))
        .where(sub.c.user_id.is_not(None))
        .group_by(sub.c.user_id)
    )
    by_user_data = by_user_rows.all()
    names = {}
    if by_user_data:
        rows = await session.execute(
            select(User.id, User.display_name).where(User.id.in_([r[0] for r in by_user_data]))
        )
        names = {r[0]: r[1] for r in rows.all()}
    day = func.date(sub.c.created_at)
    by_day_rows = await session.execute(select(day, func.sum(sub.c.amount_cny)).group_by(day).order_by(day))
    by_model_rows = await session.execute(
        select(sub.c.model_id, func.count(), func.sum(sub.c.amount_cny)).group_by(sub.c.model_id)
    )
    calls_q = select(GenerationCall.model_id, func.count()).where(GenerationCall.started_at >= since)
    if not ({Role.ADMIN, Role.REVIEWER} & set(user.roles)):
        calls_q = calls_q.where(GenerationCall.user_id == user.id)
    calls_rows = await session.execute(calls_q.group_by(GenerationCall.model_id))
    calls = {r[0]: int(r[1]) for r in calls_rows.all()}
    limits = await limits_for(session, runtime.config, None, user)
    return UsageSummary(
        total_cny=round(total, 4),
        today_user_cny=round(await spent_today(session, user.id), 4),
        daily_budget_cny=limits.daily_budget_cny,
        by_user=sorted(
            (
                UsageByUser(user_id=r[0], display_name=names.get(r[0], ""), amount_cny=round(float(r[1]), 4))
                for r in by_user_data
            ),
            key=lambda u: -u.amount_cny,
        ),
        by_day=[UsageByDay(date=str(r[0]), amount_cny=round(float(r[1]), 4)) for r in by_day_rows.all()],
        by_model=[
            UsageByModel(model_id=r[0], calls=calls.get(r[0], int(r[1])), amount_cny=round(float(r[2]), 4))
            for r in by_model_rows.all()
        ],
    )


def _config_out(runtime: RuntimeDep, budget: BudgetOut) -> ModelsConfigOut:
    cfg = runtime.config
    models = {
        key: {k: v for k, v in cfg.models.get(key).model_dump(mode="json").items() if v is not None}
        for key in ("script_llm", "keyframe", "video_draft", "video_final", "tts")
    }
    region = runtime.settings.ark_region
    return ModelsConfigOut(
        region=region,
        provider_mode=runtime.settings.provider_mode,
        currency=cfg.currency[region],
        models=models,
        budget=budget,
    )


@router.get("/config/models", response_model=ModelsConfigOut)
async def get_config(_: AdminUser, session: SessionDep, runtime: RuntimeDep) -> ModelsConfigOut:
    b = await get_budget(session, runtime.config)
    return _config_out(runtime, BudgetOut(per_job_cny=b.per_job_cny, per_user_daily_cny=b.per_user_daily_cny))


@router.patch("/config/budget", response_model=BudgetOut)
async def patch_budget(
    body: BudgetUpdate, admin: AdminUser, session: SessionDep, runtime: RuntimeDep, request: Request
) -> BudgetOut:
    b = await set_budget(
        session, runtime.config, per_job_cny=body.per_job_cny, per_user_daily_cny=body.per_user_daily_cny
    )
    audit(
        session,
        request,
        admin.id,
        "budget_update",
        target_type="config",
        per_job_cny=b.per_job_cny,
        per_user_daily_cny=b.per_user_daily_cny,
    )
    await session.commit()
    return BudgetOut(per_job_cny=b.per_job_cny, per_user_daily_cny=b.per_user_daily_cny)


@router.get("/audit-logs", response_model=Page[AuditLogOut])
async def audit_logs(
    _: AdminUser,
    session: SessionDep,
    action: str | None = Query(default=None, max_length=64),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> Page[AuditLogOut]:
    query = select(AuditLog, User.display_name).outerjoin(User, User.id == AuditLog.actor_id)
    count_q = select(func.count()).select_from(AuditLog)
    if action:
        query = query.where(AuditLog.action == action)
        count_q = count_q.where(AuditLog.action == action)
    total = int(await session.scalar(count_q) or 0)
    rows = await session.execute(
        query.order_by(AuditLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    )
    return Page(
        items=[
            AuditLogOut(
                id=log.id,
                actor_id=log.actor_id,
                actor_name=name,
                action=log.action,
                target_type=log.target_type,
                target_id=log.target_id,
                detail=log.detail or {},
                ip=log.ip,
                created_at=log.created_at,
            )
            for log, name in rows.all()
        ],
        total=total,
    )
