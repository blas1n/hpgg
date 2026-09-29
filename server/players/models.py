"""Tables for the Heroes Profile cache and quota bookkeeping. Times are UTC epoch seconds."""

from __future__ import annotations

from sqlalchemy import Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from server.db import Base


class HPCache(Base):
    """One HP answer (raw JSON body, or an error status) per endpoint + parameters."""

    __tablename__ = "hp_cache"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    status: Mapped[int] = mapped_column(Integer)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    fetched_at: Mapped[float] = mapped_column(Float)
    expires_at: Mapped[float] = mapped_column(Float)


class HPQuota(Base):
    """The last X-HP-Quota-* reading per endpoint bucket."""

    __tablename__ = "hp_quota"

    endpoint: Mapped[str] = mapped_column(String, primary_key=True)
    quota_limit: Mapped[int] = mapped_column(Integer)
    remaining: Mapped[int] = mapped_column(Integer)
    reset_at: Mapped[float] = mapped_column(Float)
    updated_at: Mapped[float] = mapped_column(Float)


class HPDailyUsage(Base):
    """Live (charged) HP calls per UTC day and endpoint — the daily budget."""

    __tablename__ = "hp_daily_usage"

    day: Mapped[str] = mapped_column(String, primary_key=True)
    endpoint: Mapped[str] = mapped_column(String, primary_key=True)
    live_calls: Mapped[int] = mapped_column(Integer)
