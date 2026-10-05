"""comments on the weekly report and hero pages

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-05 15:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "comments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("thread", sa.String(), nullable=False),
        sa.Column("nickname", sa.String(), nullable=False),
        sa.Column("tag", sa.String(), nullable=False),
        sa.Column("ip_hash", sa.String(), nullable=False),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("account_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.Float(), nullable=False),
        sa.Column("hidden_at", sa.Float(), nullable=True),
        sa.Column("hidden_reason", sa.String(), nullable=True),
        sa.Column("deleted_at", sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_comments_thread"), "comments", ["thread"], unique=False)
    op.create_index(op.f("ix_comments_ip_hash"), "comments", ["ip_hash"], unique=False)
    op.create_table(
        "comment_reports",
        sa.Column("comment_id", sa.Integer(), nullable=False),
        sa.Column("ip_hash", sa.String(), nullable=False),
        sa.Column("created_at", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(["comment_id"], ["comments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("comment_id", "ip_hash"),
    )
    op.create_table(
        "app_secrets",
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("value", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    op.drop_table("app_secrets")
    op.drop_table("comment_reports")
    op.drop_index(op.f("ix_comments_ip_hash"), table_name="comments")
    op.drop_index(op.f("ix_comments_thread"), table_name="comments")
    op.drop_table("comments")
