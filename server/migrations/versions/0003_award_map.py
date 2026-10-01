"""awards the server learns from replay answers

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-01 17:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "hp_award_map",
        sa.Column("award_id", sa.String(), nullable=False),
        sa.Column("award_key", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("learned_at", sa.Float(), nullable=False),
        sa.PrimaryKeyConstraint("award_id"),
    )


def downgrade() -> None:
    op.drop_table("hp_award_map")
