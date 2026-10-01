"""player privacy feed (HP API terms §5)

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-01 15:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "hp_private_player",
        sa.Column("region", sa.String(), nullable=False),
        sa.Column("battletag_lc", sa.String(), nullable=False),
        sa.Column("changed_at", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("region", "battletag_lc"),
    )
    op.create_table(
        "hp_feed_cursor",
        sa.Column("feed", sa.String(), nullable=False),
        sa.Column("since", sa.String(), nullable=True),
        sa.Column("after_id", sa.Integer(), nullable=True),
        sa.Column("last_ok_at", sa.Float(), nullable=False),
        sa.PrimaryKeyConstraint("feed"),
    )


def downgrade() -> None:
    op.drop_table("hp_feed_cursor")
    op.drop_table("hp_private_player")
