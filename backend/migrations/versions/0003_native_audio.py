"""原生聲音：模板的影片模型、分鏡的說話者與音效

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "templates",
        sa.Column("video_model", sa.String(length=16), nullable=False, server_default="video_final"),
    )
    op.add_column("scenes", sa.Column("speaker", sa.Text(), nullable=False, server_default=""))
    op.add_column("scenes", sa.Column("sound", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    with op.batch_alter_table("scenes") as batch:
        batch.drop_column("sound")
        batch.drop_column("speaker")
    with op.batch_alter_table("templates") as batch:
        batch.drop_column("video_model")
