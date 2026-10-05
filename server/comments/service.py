"""Comment rules: the threads the site has, what a comment may say, who may delete it, and when
reports hide it. Passwords are scrypt-hashed; addresses are only ever an HMAC."""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, select

from server.comments.models import AppSecret, Comment, CommentReport
from server.config import Settings
from server.db import Database

# the threads the site has: one per weekly report issue, one per hero page
THREAD = re.compile(r"^(weekly:\d{4}-w\d{2}|hero:[a-z0-9-]{1,40})$")
# no posing as the site
RESERVED = ("운영자", "관리자", "admin", "hpgg", "moderator")
# no links: spam is links
LINK = re.compile(r"(?i)(https?://|www\.|\b[a-z0-9-]+\.(com|net|org|kr|gg|win|io|me|xyz|top)\b)")
LIST_LIMIT = 200


def valid_nickname(v: str) -> str:
    v = v.strip()
    if not 1 <= len(v) <= 16 or any(ord(ch) < 32 for ch in v):
        raise ValueError("nickname")
    if any(word in v.lower() for word in RESERVED):
        raise ValueError("nickname")
    return v


def valid_body(v: str) -> str:
    v = v.strip()
    if not 1 <= len(v) <= 500 or v.count("\n") > 10 or LINK.search(v):
        raise ValueError("body")
    return v


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${h.hex()}"


def check_password(password: str, stored: str) -> bool:
    _, salt, h = stored.split("$")
    got = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1)
    return hmac.compare_digest(got.hex(), h)


@dataclass
class CommentView:
    id: int
    nickname: str
    tag: str
    body: str
    created_at: str


def view(c: Comment) -> CommentView:
    at = datetime.fromtimestamp(c.created_at, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    return CommentView(id=c.id, nickname=c.nickname, tag=c.tag, body=c.body, created_at=at)


class CommentService:
    def __init__(self, db: Database, settings: Settings, clock: Callable[[], float]) -> None:
        self.db = db
        self.settings = settings
        self.clock = clock
        self._key: bytes | None = None

    async def _secret(self) -> bytes:
        if self._key is None:
            given = self.settings.comment_secret.get_secret_value()
            if given:
                self._key = given.encode()
            else:
                async with self.db.session() as s:
                    row = await s.get(AppSecret, "comment_secret")
                    if row is None:
                        row = AppSecret(key="comment_secret", value=secrets.token_hex(32))
                        s.add(row)
                        await s.commit()
                    self._key = row.value.encode()
        return self._key

    async def ip_hash(self, ip: str) -> str:
        return hmac.new(await self._secret(), ip.encode(), hashlib.sha256).hexdigest()

    async def list(self, thread: str) -> list[CommentView]:
        async with self.db.session() as s:
            rows = (
                await s.scalars(
                    select(Comment)
                    .where(
                        Comment.thread == thread,
                        Comment.hidden_at.is_(None),
                        Comment.deleted_at.is_(None),
                    )
                    .order_by(Comment.created_at, Comment.id)
                    .limit(LIST_LIMIT)
                )
            ).all()
        return [view(c) for c in rows]

    async def post(
        self, *, thread: str, nickname: str, password: str, body: str, ip: str
    ) -> CommentView:
        h = await self.ip_hash(ip)
        c = Comment(
            thread=thread,
            nickname=nickname,
            tag=hashlib.sha256(h.encode()).hexdigest()[:4],
            ip_hash=h,
            password_hash=hash_password(password),
            body=body,
            created_at=self.clock(),
        )
        async with self.db.session() as s:
            s.add(c)
            await s.commit()
            await s.refresh(c)
        return view(c)

    async def delete(self, comment_id: int, password: str) -> bool | None:
        """True deleted, False wrong password, None no such comment."""
        async with self.db.session() as s:
            c = await s.get(Comment, comment_id)
            if c is None or c.deleted_at is not None:
                return None
            if not check_password(password, c.password_hash):
                return False
            c.deleted_at = self.clock()
            await s.commit()
            return True

    async def report(self, comment_id: int, ip: str) -> bool:
        """False when there is no such comment. Hides it at the reports threshold."""
        h = await self.ip_hash(ip)
        async with self.db.session() as s:
            c = await s.get(Comment, comment_id)
            if c is None or c.deleted_at is not None:
                return False
            if await s.get(CommentReport, (comment_id, h)) is None:
                s.add(CommentReport(comment_id=comment_id, ip_hash=h, created_at=self.clock()))
                await s.flush()
            n = await s.scalar(
                select(func.count())
                .select_from(CommentReport)
                .where(CommentReport.comment_id == comment_id)
            )
            if (n or 0) >= self.settings.comment_hide_reports and c.hidden_at is None:
                c.hidden_at = self.clock()
                c.hidden_reason = "reports"
            await s.commit()
            return True
