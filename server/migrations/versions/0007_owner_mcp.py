"""the owner's MCP: OAuth clients, consents, codes, tokens; the owner's games

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-11 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "mcp_clients",
        sa.Column("client_id", sa.String(), nullable=False),
        sa.Column("info", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Float(), nullable=False),
        sa.PrimaryKeyConstraint("client_id"),
    )
    op.create_table(
        "mcp_auth_requests",
        sa.Column("req_hash", sa.String(), nullable=False),
        sa.Column("client_id", sa.String(), nullable=False),
        sa.Column("params", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Float(), nullable=False),
        sa.PrimaryKeyConstraint("req_hash"),
    )
    op.create_table(
        "mcp_codes",
        sa.Column("code_hash", sa.String(), nullable=False),
        sa.Column("client_id", sa.String(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("params", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("code_hash"),
    )
    op.create_index(op.f("ix_mcp_codes_account_id"), "mcp_codes", ["account_id"], unique=False)
    op.create_table(
        "mcp_tokens",
        sa.Column("token_hash", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("client_id", sa.String(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("scopes", sa.String(), nullable=False),
        sa.Column("resource", sa.String(), nullable=True),
        sa.Column("expires_at", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("token_hash"),
    )
    op.create_index(op.f("ix_mcp_tokens_account_id"), "mcp_tokens", ["account_id"], unique=False)
    op.create_table(
        "owner_matches",
        sa.Column("match_id", sa.Integer(), nullable=False),
        sa.Column("battletag", sa.String(), nullable=False),
        sa.Column("date", sa.String(), nullable=False),
        sa.Column("row", sa.Text(), nullable=False),
        sa.Column("game", sa.Text(), nullable=True),
        sa.Column("game_missing", sa.Boolean(), nullable=False),
        sa.Column("fetched_at", sa.Float(), nullable=False),
        sa.PrimaryKeyConstraint("match_id"),
    )
    op.create_index(
        op.f("ix_owner_matches_battletag"), "owner_matches", ["battletag"], unique=False
    )
    op.create_index(op.f("ix_owner_matches_date"), "owner_matches", ["date"], unique=False)
    op.create_table(
        "owner_sync",
        sa.Column("battletag", sa.String(), nullable=False),
        sa.Column("started_at", sa.Float(), nullable=False),
        sa.Column("finished_at", sa.Float(), nullable=True),
        sa.Column("result", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("battletag"),
    )


def downgrade() -> None:
    op.drop_table("owner_sync")
    op.drop_index(op.f("ix_owner_matches_date"), table_name="owner_matches")
    op.drop_index(op.f("ix_owner_matches_battletag"), table_name="owner_matches")
    op.drop_table("owner_matches")
    op.drop_index(op.f("ix_mcp_tokens_account_id"), table_name="mcp_tokens")
    op.drop_table("mcp_tokens")
    op.drop_index(op.f("ix_mcp_codes_account_id"), table_name="mcp_codes")
    op.drop_table("mcp_codes")
    op.drop_table("mcp_auth_requests")
    op.drop_table("mcp_clients")
