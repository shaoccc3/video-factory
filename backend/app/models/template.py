"""影片模板：管理員維護，任務建立時快照。"""

from sqlalchemy import Boolean, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampedMixin


class Template(TimestampedMixin, Base):
    __tablename__ = "templates"

    key: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text, default="")
    video_type: Mapped[str] = mapped_column(String(32))
    ratio: Mapped[str] = mapped_column(String(8))
    resolution: Mapped[str] = mapped_column(String(8), default="720p")
    min_duration_s: Mapped[int] = mapped_column(Integer)
    max_duration_s: Mapped[int] = mapped_column(Integer)
    min_shots: Mapped[int] = mapped_column(Integer)
    max_shots: Mapped[int] = mapped_column(Integer)
    audio_mode: Mapped[str] = mapped_column(String(16))
    # 正片用的影片模型鍵：video_final（Seedance 2.0）或 video_long（Seedance 2.5）
    video_model: Mapped[str] = mapped_column(String(16), default="video_final")
    subtitle_required: Mapped[bool] = mapped_column(Boolean, default=False)
    style_prefix: Mapped[str] = mapped_column(Text, default="")
    prompt_template: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
