"""預算：單任務上限與每人每日上限（以 CNY 計，按賬本實際金額）。"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, time

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.models_config import ModelsConfig
from app.models import CostLedger, Job, User
from app.providers.errors import BudgetExceededError
from app.services.settings_store import get_budget

NEAR_LIMIT_RATIO = 0.8


def start_of_today() -> datetime:
    now = datetime.now(UTC)
    return datetime.combine(now.date(), time.min, tzinfo=UTC)


async def spent_today(session: AsyncSession, user_id: uuid.UUID) -> float:
    total = await session.scalar(
        select(func.coalesce(func.sum(CostLedger.amount_cny), 0)).where(
            CostLedger.user_id == user_id, CostLedger.created_at >= start_of_today()
        )
    )
    return float(total or 0)


async def spent_on_job(session: AsyncSession, job_id: uuid.UUID) -> float:
    total = await session.scalar(
        select(func.coalesce(func.sum(CostLedger.amount_cny), 0)).where(CostLedger.job_id == job_id)
    )
    return float(total or 0)


@dataclass(frozen=True)
class Limits:
    job_budget_cny: float
    daily_budget_cny: float


async def limits_for(session: AsyncSession, config: ModelsConfig, job: Job | None, user: User) -> Limits:
    budget = await get_budget(session, config)
    daily = user.daily_budget_cny if user.daily_budget_cny is not None else budget.per_user_daily_cny
    job_budget = job.budget_cny if job is not None else budget.per_job_cny
    return Limits(job_budget_cny=float(job_budget), daily_budget_cny=float(daily))


class BudgetGuard:
    def __init__(self, sessionmaker: async_sessionmaker[AsyncSession], config: ModelsConfig) -> None:
        self._sm = sessionmaker
        self._config = config

    async def check(self, *, job_id: uuid.UUID | None, user_id: uuid.UUID | None, add_cny: float) -> None:
        """加上這次調用的預估金額後超限就拋 BudgetExceededError。"""
        if user_id is None:
            return
        async with self._sm() as session:
            user = await session.get(User, user_id)
            if user is None:
                return
            job = await session.get(Job, job_id) if job_id else None
            limits = await limits_for(session, self._config, job, user)
            if job is not None:
                used = await spent_on_job(session, job.id)
                if used + add_cny > limits.job_budget_cny + 1e-9:
                    raise BudgetExceededError(
                        f"任務預算不足：已用 {used:.2f}，本次約 {add_cny:.2f}，上限 {limits.job_budget_cny:.2f} 元",
                        scope="job",
                    )
            today = await spent_today(session, user.id)
            if today + add_cny > limits.daily_budget_cny + 1e-9:
                raise BudgetExceededError(
                    f"今日預算不足：已用 {today:.2f}，本次約 {add_cny:.2f}，上限 {limits.daily_budget_cny:.2f} 元",
                    scope="daily",
                )
