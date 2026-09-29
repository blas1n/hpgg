"""Every feature's tables, imported in one place so `Base.metadata` (and Alembic) sees them all."""

from server.db import Base
from server.players.models import HPCache, HPDailyUsage, HPQuota

__all__ = ["Base", "HPCache", "HPDailyUsage", "HPQuota"]
