"""Comment tables. Times are UTC epoch seconds. No address and no password is stored: `ip_hash`
is an HMAC of the address (rate limits, reports, the 4-character tag), `password_hash` a scrypt."""

from __future__ import annotations

from sqlalchemy import Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from server.db import Base


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # "weekly:2026-w40", "hero:valla"
    thread: Mapped[str] = mapped_column(String, index=True)
    nickname: Mapped[str] = mapped_column(String)
    tag: Mapped[str] = mapped_column(String)
    ip_hash: Mapped[str] = mapped_column(String, index=True)
    password_hash: Mapped[str] = mapped_column(String)
    body: Mapped[str] = mapped_column(Text)
    # a later Battle.net login (#28); anonymous comments leave it empty
    account_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[float] = mapped_column(Float)
    hidden_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    # "reports" (three addresses) or "admin"
    hidden_reason: Mapped[str | None] = mapped_column(String, nullable=True)
    deleted_at: Mapped[float | None] = mapped_column(Float, nullable=True)


class CommentReport(Base):
    """One report per comment and address."""

    __tablename__ = "comment_reports"

    comment_id: Mapped[int] = mapped_column(
        ForeignKey("comments.id", ondelete="CASCADE"), primary_key=True
    )
    ip_hash: Mapped[str] = mapped_column(String, primary_key=True)
    created_at: Mapped[float] = mapped_column(Float)


class AppSecret(Base):
    """Secrets the server makes for itself on first start (the comment HMAC key)."""

    __tablename__ = "app_secrets"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(String)
