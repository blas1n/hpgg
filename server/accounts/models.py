"""Account tables. Times are UTC epoch seconds. Only Battle.net's account id and BattleTag are
kept; a session row holds the SHA-256 of the cookie, never the cookie itself; Blizzard's access
token is never stored."""

from __future__ import annotations

from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from server.db import Base


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bnet_id: Mapped[str] = mapped_column(String, unique=True)
    battletag: Mapped[str] = mapped_column(String)
    # KR / NA / EU, chosen by the member (Battle.net does not say where they play HotS)
    region: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[float] = mapped_column(Float)
    last_seen_at: Mapped[float] = mapped_column(Float)


class Session(Base):
    __tablename__ = "sessions"

    token_hash: Mapped[str] = mapped_column(String, primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[float] = mapped_column(Float)
    expires_at: Mapped[float] = mapped_column(Float)


class OAuthState(Base):
    """One sign-in in flight: single use, a few minutes long."""

    __tablename__ = "oauth_states"

    state_hash: Mapped[str] = mapped_column(String, primary_key=True)
    verifier: Mapped[str] = mapped_column(String)
    next_path: Mapped[str] = mapped_column(String)
    created_at: Mapped[float] = mapped_column(Float)


class HeroPoolEntry(Base):
    """One hero in a member's pool. The member keeps the list (any hero, by hand); a sync adds
    this season's heroes from Heroes Profile. `seq` keeps the order heroes came in."""

    __tablename__ = "hero_pool"

    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True
    )
    # Heroes Profile's hero name ("Li Li", "Lúcio"): the key the season rows and the site share
    hero: Mapped[str] = mapped_column(String, primary_key=True)
    seq: Mapped[int] = mapped_column(Integer)
    added_at: Mapped[float] = mapped_column(Float)
