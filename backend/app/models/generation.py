"""外部調用記錄與成本賬本（賬本只增不改）。"""

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampedMixin


class GenerationCall(TimestampedMixin, Base):
    __tablename__ = "generation_calls"

    job_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("jobs.id"), index=True)
    scene_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("scenes.id"))
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    provider: Mapped[str] = mapped_column(String(16))
    model_key: Mapped[str] = mapped_column(String(32))
    model_id: Mapped[str] = mapped_column(String(128))
    remote_task_id: Mapped[str | None] = mapped_column(String(128))
    request_summary: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="running")
    error_kind: Mapped[str | None] = mapped_column(String(32))
    error_code: Mapped[str | None] = mapped_column(String(100))
    error_message: Mapped[str | None] = mapped_column(Text)
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CostLedger(TimestampedMixin, Base):
    __tablename__ = "cost_ledger"

    generation_call_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("generation_calls.id"))
    job_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("jobs.id"), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), index=True)
    model_key: Mapped[str] = mapped_column(String(32))
    model_id: Mapped[str] = mapped_column(String(128))
    usage: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    unit_price: Mapped[float] = mapped_column(Numeric(14, 6, asdecimal=False))
    currency: Mapped[str] = mapped_column(String(8))
    amount: Mapped[float] = mapped_column(Numeric(14, 6, asdecimal=False))
    amount_cny: Mapped[float] = mapped_column(Numeric(12, 4, asdecimal=False))
    estimated: Mapped[bool] = mapped_column(default=False)
