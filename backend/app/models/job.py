"""任務、分鏡、批量。"""

import uuid

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampedMixin


class Batch(TimestampedMixin, Base):
    __tablename__ = "batches"

    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    template_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("templates.id"))
    source_asset_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("assets.id"))
    total: Mapped[int] = mapped_column(Integer, default=0)
    max_parallel: Mapped[int] = mapped_column(Integer, default=2)
    draft_mode: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(16), default="running")


class Job(TimestampedMixin, Base):
    __tablename__ = "jobs"

    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    template_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("templates.id"))
    template_snapshot: Mapped[dict[str, object]] = mapped_column(JSON)
    batch_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("batches.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    video_type: Mapped[str] = mapped_column(String(32), index=True)
    inputs: Mapped[dict[str, object]] = mapped_column(JSON)
    options: Mapped[dict[str, object]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(32), index=True)
    phase: Mapped[str] = mapped_column(String(16), default="final")
    region: Mapped[str] = mapped_column(String(16))
    ratio: Mapped[str] = mapped_column(String(8))
    resolution: Mapped[str] = mapped_column(String(8))
    seed: Mapped[int] = mapped_column(Integer)
    draft_mode: Mapped[bool] = mapped_column(Boolean, default=False)
    continuous_shots: Mapped[bool] = mapped_column(Boolean, default=False)
    budget_cny: Mapped[float] = mapped_column(Numeric(12, 4, asdecimal=False))
    estimated_cost_cny: Mapped[float | None] = mapped_column(Numeric(12, 4, asdecimal=False))
    actual_cost_cny: Mapped[float] = mapped_column(Numeric(12, 4, asdecimal=False), default=0)
    warnings: Mapped[list[str]] = mapped_column(JSON, default=list)
    final_asset_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("assets.id"))
    cover_asset_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("assets.id"))
    subtitle_asset_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("assets.id"))
    error_kind: Mapped[str | None] = mapped_column(String(32))
    error_code: Mapped[str | None] = mapped_column(String(100))
    error_message: Mapped[str | None] = mapped_column(Text)

    scenes: Mapped[list["Scene"]] = relationship(
        back_populates="job", order_by="Scene.index", cascade="all, delete-orphan"
    )


class Scene(TimestampedMixin, Base):
    __tablename__ = "scenes"

    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    index: Mapped[int] = mapped_column(Integer)
    narration: Mapped[str] = mapped_column(Text, default="")
    visual_prompt: Mapped[str] = mapped_column(Text, default="")
    shot_type: Mapped[str] = mapped_column(String(50), default="")
    camera_move: Mapped[str] = mapped_column(String(50), default="")
    duration_s: Mapped[float] = mapped_column(Float)
    needs_first_frame: Mapped[bool] = mapped_column(Boolean, default=False)
    screen_text: Mapped[str] = mapped_column(Text, default="")
    speaker: Mapped[str] = mapped_column(Text, default="")  # 說話者（旁白或角色泛稱）
    sound: Mapped[str] = mapped_column(Text, default="")  # 音效／環境音描述
    first_frame_asset_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("assets.id"))
    first_frame_generated: Mapped[bool] = mapped_column(Boolean, default=False)
    ref_asset_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    attempt: Mapped[int] = mapped_column(Integer, default=0)
    remote_task_id: Mapped[str | None] = mapped_column(String(128))
    video_asset_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("assets.id"))
    last_frame_asset_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("assets.id"))
    audio_asset_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("assets.id"))
    audio_duration_s: Mapped[float | None] = mapped_column(Float)
    is_draft: Mapped[bool] = mapped_column(Boolean, default=False)
    error_kind: Mapped[str | None] = mapped_column(String(32))
    error_message: Mapped[str | None] = mapped_column(Text)

    job: Mapped[Job] = relationship(back_populates="scenes")
