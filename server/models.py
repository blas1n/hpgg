"""Every feature's tables, imported in one place so `Base.metadata` (and Alembic) sees them all."""

from server.accounts.models import Account, HeroPoolEntry, OAuthState, Session
from server.comments.models import AppSecret, Comment, CommentReport
from server.db import Base
from server.mcp.models import (
    McpAuthRequest,
    McpClient,
    McpCode,
    McpToken,
    OwnerMatch,
    OwnerSync,
)
from server.players.models import (
    HPAwardMap,
    HPCache,
    HPDailyUsage,
    HPFeedCursor,
    HPPrivatePlayer,
    HPQuota,
)

__all__ = [
    "Account",
    "AppSecret",
    "Base",
    "Comment",
    "CommentReport",
    "HPAwardMap",
    "HPCache",
    "HPDailyUsage",
    "HPFeedCursor",
    "HPPrivatePlayer",
    "HPQuota",
    "HeroPoolEntry",
    "McpAuthRequest",
    "McpClient",
    "McpCode",
    "McpToken",
    "OAuthState",
    "OwnerMatch",
    "OwnerSync",
    "Session",
]
