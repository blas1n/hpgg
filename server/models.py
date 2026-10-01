"""Every feature's tables, imported in one place so `Base.metadata` (and Alembic) sees them all."""

from server.db import Base
from server.players.models import (
    HPAwardMap,
    HPCache,
    HPDailyUsage,
    HPFeedCursor,
    HPPrivatePlayer,
    HPQuota,
)

__all__ = [
    "Base",
    "HPAwardMap",
    "HPCache",
    "HPDailyUsage",
    "HPFeedCursor",
    "HPPrivatePlayer",
    "HPQuota",
]
