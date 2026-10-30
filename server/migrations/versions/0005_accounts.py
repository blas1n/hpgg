"""accounts, sessions and sign-ins in flight (Battle.net, #28)

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-30 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "accounts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("bnet_id", sa.String(), nullable=False),
        sa.Column("battletag", sa.String(), nullable=False),
        sa.Column("region", sa.String(), nullable=True),
        sa.Column("created_at", sa.Float(), nullable=False),
        sa.Column("last_seen_at", sa.Float(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("bnet_id"),
    )
    op.create_table(
        "sessions",
        sa.Column("token_hash", sa.String(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.Float(), nullable=False),
        sa.Column("expires_at", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("token_hash"),
    )
    op.create_index(op.f("ix_sessions_account_id"), "sessions", ["account_id"], unique=False)
    op.create_table(
        "oauth_states",
        sa.Column("state_hash", sa.String(), nullable=False),
        sa.Column("verifier", sa.String(), nullable=False),
        sa.Column("next_path", sa.String(), nullable=False),
        sa.Column("created_at", sa.Float(), nullable=False),
        sa.PrimaryKeyConstraint("state_hash"),
    )


def downgrade() -> None:
    op.drop_table("oauth_states")
    op.drop_index(op.f("ix_sessions_account_id"), table_name="sessions")
    op.drop_table("sessions")
    op.drop_table("accounts")
