"""Owner-MCP tables. Times are UTC epoch seconds. Codes and tokens are kept as SHA-256 hashes only;
`owner_matches` holds the owner's own rows and per-game hero lists, never another player's
BattleTag or stat line."""

from __future__ import annotations

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from server.db import Base


class McpClient(Base):
    """A client registered through dynamic client registration (ChatGPT, once per connector)."""

    __tablename__ = "mcp_clients"

    client_id: Mapped[str] = mapped_column(String, primary_key=True)
    info: Mapped[str] = mapped_column(Text)  # OAuthClientInformationFull as JSON
    created_at: Mapped[float] = mapped_column(Float)


class McpAuthRequest(Base):
    """An /authorize waiting on the owner's consent: single use, a few minutes long."""

    __tablename__ = "mcp_auth_requests"

    req_hash: Mapped[str] = mapped_column(String, primary_key=True)
    client_id: Mapped[str] = mapped_column(String)
    params: Mapped[str] = mapped_column(Text)  # AuthorizationParams as JSON
    created_at: Mapped[float] = mapped_column(Float)


class McpCode(Base):
    __tablename__ = "mcp_codes"

    code_hash: Mapped[str] = mapped_column(String, primary_key=True)
    client_id: Mapped[str] = mapped_column(String)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    params: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[float] = mapped_column(Float)


class McpToken(Base):
    __tablename__ = "mcp_tokens"

    token_hash: Mapped[str] = mapped_column(String, primary_key=True)
    kind: Mapped[str] = mapped_column(String)  # "access" | "refresh"
    client_id: Mapped[str] = mapped_column(String)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    scopes: Mapped[str] = mapped_column(String)  # space-separated
    resource: Mapped[str | None] = mapped_column(String, nullable=True)
    expires_at: Mapped[float] = mapped_column(Float)


class OwnerMatch(Base):
    """One of the owner's Storm League games: their own HP row, plus the game's shape from the
    replay (length, heroes, bans, draft, party sizes, team XP) once fetched."""

    __tablename__ = "owner_matches"

    match_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    battletag: Mapped[str] = mapped_column(String, index=True)
    date: Mapped[str] = mapped_column(String, index=True)
    row: Mapped[str] = mapped_column(Text)  # the owner's normalised row as JSON
    game: Mapped[str | None] = mapped_column(Text, nullable=True)  # None until fetched
    # the replay was asked and HP had none (404/403): not asked again
    game_missing: Mapped[bool] = mapped_column(Boolean, default=False)
    fetched_at: Mapped[float] = mapped_column(Float)


class OwnerSync(Base):
    """The last refresh of one owner's games."""

    __tablename__ = "owner_sync"

    battletag: Mapped[str] = mapped_column(String, primary_key=True)
    started_at: Mapped[float] = mapped_column(Float)
    finished_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    result: Mapped[str | None] = mapped_column(String, nullable=True)
