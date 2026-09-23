"""審核記錄、審計日誌、可覆蓋的系統設定。"""

import uuid

from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampedMixin


class Review(TimestampedMixin, Base):
    __tablename__ = "reviews"

    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("jobs.id"), index=True)
    reviewer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    decision: Mapped[str] = mapped_column(String(16))
    checklist: Mapped[dict[str, bool]] = mapped_column(JSON, default=dict)
    reason: Mapped[str] = mapped_column(Text, default="")


class AuditLog(TimestampedMixin, Base):
    __tablename__ = "audit_logs"

    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), index=True)
    action: Mapped[str] = mapped_column(String(64), index=True)
    target_type: Mapped[str | None] = mapped_column(String(32))
    target_id: Mapped[str | None] = mapped_column(String(64))
    detail: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(255))


class AppSetting(TimestampedMixin, Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), unique=True)
    value: Mapped[dict[str, object]] = mapped_column(JSON)
