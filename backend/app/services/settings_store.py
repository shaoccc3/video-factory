"""可在管理頁覆蓋的設定（目前只有預算）。"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models_config import ModelsConfig
from app.models import AppSetting

BUDGET_KEY = "budget"


@dataclass(frozen=True)
class BudgetSettings:
    per_job_cny: float
    per_user_daily_cny: float


async def get_budget(session: AsyncSession, config: ModelsConfig) -> BudgetSettings:
    row = await session.scalar(select(AppSetting).where(AppSetting.key == BUDGET_KEY))
    value = row.value if row else {}
    return BudgetSettings(
        per_job_cny=float(value.get("per_job_cny", config.budget.per_job_cny)),  # type: ignore[arg-type]
        per_user_daily_cny=float(
            value.get("per_user_daily_cny", config.budget.per_user_daily_cny)  # type: ignore[arg-type]
        ),
    )


async def set_budget(
    session: AsyncSession,
    config: ModelsConfig,
    *,
    per_job_cny: float | None,
    per_user_daily_cny: float | None,
) -> BudgetSettings:
    current = await get_budget(session, config)
    new = BudgetSettings(
        per_job_cny=per_job_cny if per_job_cny is not None else current.per_job_cny,
        per_user_daily_cny=(
            per_user_daily_cny if per_user_daily_cny is not None else current.per_user_daily_cny
        ),
    )
    row = await session.scalar(select(AppSetting).where(AppSetting.key == BUDGET_KEY))
    value: dict[str, object] = {
        "per_job_cny": new.per_job_cny,
        "per_user_daily_cny": new.per_user_daily_cny,
    }
    if row is None:
        session.add(AppSetting(key=BUDGET_KEY, value=value))
    else:
        row.value = value
    return new
