"""調用記錄與成本賬本。每次寫入獨立提交，任務失敗也保留記錄。"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import CostLedger, GenerationCall, Job
from app.providers.errors import ProviderError


@dataclass(frozen=True)
class Charge:
    usage: dict[str, object]
    unit_price: float
    currency: str
    amount: float
    amount_cny: float


class CallRecorder:
    def __init__(self, sessionmaker: async_sessionmaker[AsyncSession]) -> None:
        self._sm = sessionmaker

    async def start(
        self,
        *,
        job_id: uuid.UUID | None,
        scene_id: uuid.UUID | None,
        user_id: uuid.UUID | None,
        provider: str,
        model_key: str,
        model_id: str,
        summary: dict[str, object],
        attempt: int = 1,
    ) -> uuid.UUID:
        async with self._sm() as session:
            call = GenerationCall(
                job_id=job_id,
                scene_id=scene_id,
                user_id=user_id,
                provider=provider,
                model_key=model_key,
                model_id=model_id,
                request_summary=summary,
                status="running",
                attempt=attempt,
                started_at=datetime.now(UTC),
            )
            session.add(call)
            await session.commit()
            return call.id

    async def set_remote(self, call_id: uuid.UUID, remote_task_id: str) -> None:
        async with self._sm() as session:
            await session.execute(
                update(GenerationCall)
                .where(GenerationCall.id == call_id)
                .values(remote_task_id=remote_task_id)
            )
            await session.commit()

    async def succeed(self, call_id: uuid.UUID, charge: Charge | None) -> None:
        async with self._sm() as session:
            call = await session.get(GenerationCall, call_id)
            if call is None:
                return
            call.status = "succeeded"
            call.finished_at = datetime.now(UTC)
            if charge is not None:
                session.add(
                    CostLedger(
                        generation_call_id=call.id,
                        job_id=call.job_id,
                        user_id=call.user_id,
                        model_key=call.model_key,
                        model_id=call.model_id,
                        usage=charge.usage,
                        unit_price=charge.unit_price,
                        currency=charge.currency,
                        amount=charge.amount,
                        amount_cny=charge.amount_cny,
                    )
                )
                if call.job_id is not None and charge.amount_cny:
                    await session.execute(
                        update(Job)
                        .where(Job.id == call.job_id)
                        .values(actual_cost_cny=Job.actual_cost_cny + charge.amount_cny)
                    )
            await session.commit()

    async def fail(self, call_id: uuid.UUID, error: BaseException) -> None:
        async with self._sm() as session:
            call = await session.get(GenerationCall, call_id)
            if call is None:
                return
            call.status = "cancelled" if getattr(error, "cancelled", False) else "failed"
            call.finished_at = datetime.now(UTC)
            if isinstance(error, ProviderError):
                call.error_kind = error.kind.value
                call.error_code = error.code
                call.error_message = str(error)[:500]
            else:
                call.error_kind = "internal"
                call.error_message = type(error).__name__
            await session.commit()
