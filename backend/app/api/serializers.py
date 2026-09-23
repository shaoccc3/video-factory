"""ORM 物件轉成 API 回應。列表會批量載入關聯名稱，避免 N+1 查詢。"""

import uuid
from collections.abc import Sequence

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import (
    AssetOut,
    CostEstimateOut,
    CostItemOut,
    JobDetail,
    JobInputs,
    JobOptionsOut,
    JobSummary,
    Progress,
    ReviewOut,
    SceneOut,
)
from app.models import Asset, Job, Review, Scene, Template, User
from app.models.enums import AudioMode, JobStatus, SceneStatus
from app.pipeline.common import job_options
from app.pipeline.estimate import CostEstimate, estimate_job
from app.services.jobs import allowed_actions
from app.services.runtime import Runtime

API = "/api/v1"


def asset_out(asset: Asset) -> AssetOut:
    return AssetOut(
        id=asset.id,
        kind=asset.kind,
        mime=asset.mime,
        size=asset.size,
        width=asset.width,
        height=asset.height,
        duration_s=asset.duration_s,
        tags=asset.tags or [],
        display_name=asset.display_name,
        source=asset.source,
        created_at=asset.created_at,
        content_url=f"{API}/assets/{asset.id}/content",
        thumbnail_url=f"{API}/assets/{asset.id}/thumbnail" if asset.thumbnail_key else None,
    )


async def _names(
    session: AsyncSession, model: type[User] | type[Template], ids: set[uuid.UUID]
) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    column = User.display_name if model is User else Template.name
    rows = await session.execute(select(model.id, column).where(model.id.in_(ids)))
    return {row[0]: row[1] for row in rows.all()}


async def job_summaries(session: AsyncSession, jobs: Sequence[Job]) -> list[JobSummary]:
    ids = [j.id for j in jobs]
    progress: dict[uuid.UUID, Progress] = {}
    if ids:
        rows = await session.execute(
            select(
                Scene.job_id,
                func.count(),
                func.sum(case((Scene.status == SceneStatus.SUCCEEDED.value, 1), else_=0)),
                func.sum(case((Scene.status == SceneStatus.FAILED.value, 1), else_=0)),
            )
            .where(Scene.job_id.in_(ids))
            .group_by(Scene.job_id)
        )
        progress = {
            r[0]: Progress(total=int(r[1]), succeeded=int(r[2] or 0), failed=int(r[3] or 0))
            for r in rows.all()
        }
    owners = await _names(session, User, {j.owner_id for j in jobs})
    templates = await _names(session, Template, {j.template_id for j in jobs})
    return [
        JobSummary(
            id=j.id,
            title=j.title,
            status=JobStatus(j.status),
            video_type=j.video_type,
            template_id=j.template_id,
            template_name=templates.get(j.template_id, str(j.template_snapshot.get("name", ""))),
            owner_id=j.owner_id,
            owner_name=owners.get(j.owner_id, ""),
            ratio=j.ratio,
            draft_mode=j.draft_mode,
            batch_id=j.batch_id,
            estimated_cost_cny=j.estimated_cost_cny,
            actual_cost_cny=round(float(j.actual_cost_cny or 0), 4),
            final_asset_id=j.final_asset_id,
            cover_asset_id=j.cover_asset_id,
            progress=progress.get(j.id, Progress(total=0, succeeded=0, failed=0)),
            created_at=j.created_at,
            updated_at=j.updated_at,
        )
        for j in jobs
    ]


def estimate_out(est: CostEstimate) -> CostEstimateOut:
    return CostEstimateOut(
        total_cny=est.total_cny,
        items=[CostItemOut(**item.__dict__) for item in est.items],
        budget_per_job_cny=est.budget_per_job_cny,
        spent_today_cny=est.spent_today_cny,
        daily_budget_cny=est.daily_budget_cny,
        within_budget=est.within_budget,
        near_limit=est.near_limit,
    )


ESTIMATE_STATUSES = (
    JobStatus.STORYBOARD_READY,
    JobStatus.REJECTED,
    JobStatus.FAILED,
    JobStatus.BUDGET_EXCEEDED,
)


async def job_detail(session: AsyncSession, runtime: Runtime, job: Job, viewer: User) -> JobDetail:
    [summary] = await job_summaries(session, [job])
    scenes = list(
        (await session.scalars(select(Scene).where(Scene.job_id == job.id).order_by(Scene.index))).all()
    )
    reviews = list(
        (
            await session.scalars(
                select(Review).where(Review.job_id == job.id).order_by(Review.created_at.desc())
            )
        ).all()
    )
    reviewer_names = await _names(session, User, {r.reviewer_id for r in reviews})
    estimate = None
    if scenes and JobStatus(job.status) in ESTIMATE_STATUSES:
        owner = await session.get(User, job.owner_id)
        if owner is not None:
            estimate = estimate_out(await estimate_job(session, runtime.config, job, scenes, owner))
    opts = job_options(job)
    return JobDetail(
        **summary.model_dump(),
        inputs=JobInputs(
            topic=str(job.inputs.get("topic", "")), extra=str(job.inputs.get("extra", "") or "")
        ),
        options=JobOptionsOut(
            target_duration_s=opts.target_duration_s,
            audio_mode=AudioMode(opts.audio_mode),
            continuous_shots=opts.continuous_shots,
            product_asset_ids=list(opts.product_asset_ids),
            logo_asset_id=opts.logo_asset_id,
            bgm_asset_id=opts.bgm_asset_id,
            image_asset_id=opts.image_asset_id,
        ),
        seed=job.seed,
        scenes=[SceneOut.model_validate(s) for s in scenes],
        warnings=job.warnings or [],
        estimate=estimate,
        error_kind=job.error_kind,
        error_code=job.error_code,
        error_message=job.error_message,
        subtitle_asset_id=job.subtitle_asset_id,
        reviews=[
            ReviewOut(
                id=r.id,
                reviewer_id=r.reviewer_id,
                reviewer_name=reviewer_names.get(r.reviewer_id, ""),
                decision=r.decision,
                checklist=r.checklist,
                reason=r.reason,
                created_at=r.created_at,
            )
            for r in reviews
        ],
        allowed_actions=allowed_actions(job, viewer),
    )
