"""任務狀態機。狀態轉換一律用條件更新（WHERE status IN ...），並發時只有一方成功。"""

import uuid
from collections.abc import Iterable

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Job
from app.models.enums import JobStatus as S

TRANSITIONS: dict[S, frozenset[S]] = {
    S.DRAFT: frozenset({S.SCRIPTING, S.CANCELLED}),
    S.SCRIPTING: frozenset({S.STORYBOARD_READY, S.FAILED, S.CANCELLED, S.BUDGET_EXCEEDED}),
    S.STORYBOARD_READY: frozenset({S.SCRIPTING, S.GENERATING, S.CANCELLED, S.BUDGET_EXCEEDED}),
    S.GENERATING: frozenset({S.COMPOSING, S.FAILED, S.CANCELLED, S.BUDGET_EXCEEDED}),
    S.COMPOSING: frozenset({S.IN_REVIEW, S.FAILED, S.CANCELLED, S.BUDGET_EXCEEDED}),
    S.IN_REVIEW: frozenset({S.APPROVED, S.REJECTED, S.GENERATING, S.CANCELLED}),
    S.REJECTED: frozenset({S.STORYBOARD_READY, S.SCRIPTING, S.GENERATING, S.CANCELLED}),
    S.FAILED: frozenset({S.SCRIPTING, S.GENERATING, S.COMPOSING, S.CANCELLED}),
    S.BUDGET_EXCEEDED: frozenset({S.SCRIPTING, S.GENERATING, S.COMPOSING, S.CANCELLED}),
    S.APPROVED: frozenset(),
    S.CANCELLED: frozenset(),
}

ACTIVE = frozenset({S.SCRIPTING, S.GENERATING, S.COMPOSING})
TERMINAL = frozenset({S.APPROVED, S.CANCELLED})


class InvalidTransitionError(Exception):
    pass


def can_transition(current: str, target: S) -> bool:
    return target in TRANSITIONS[S(current)]


async def transition(
    session: AsyncSession,
    job_id: uuid.UUID,
    target: S,
    *,
    from_statuses: Iterable[S] | None = None,
    **values: object,
) -> bool:
    """條件更新狀態。from_statuses 省略時為所有可轉到 target 的狀態。返回是否成功。"""
    sources = (
        set(from_statuses)
        if from_statuses is not None
        else {src for src, dsts in TRANSITIONS.items() if target in dsts}
    )
    sources = {s for s in sources if target in TRANSITIONS[s]}
    if not sources:
        raise InvalidTransitionError(f"沒有能轉到 {target} 的來源狀態")
    result = await session.execute(
        update(Job)
        .where(Job.id == job_id, Job.status.in_([s.value for s in sources]))
        .values(status=target.value, **values)
        .execution_options(synchronize_session=False)
    )
    return bool(result.rowcount)  # type: ignore[attr-defined]
