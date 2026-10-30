"""a member's hero pool: kept by hand, filled by a sync on request (stage C)

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-30 16:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "hero_pool",
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("hero", sa.String(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("added_at", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("account_id", "hero"),
    )


def downgrade() -> None:
    op.drop_table("hero_pool")
