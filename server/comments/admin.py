"""The owner's moderation, on the Mac mini (no web admin). In the container:

    python -m server.comments.admin list [--hidden] [--thread weekly:2026-w40]
    python -m server.comments.admin hide|restore|delete <id>

e.g. `docker --context colima exec hpgg-api python -m server.comments.admin list --hidden`.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from server.config import Settings


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="server.comments.admin")
    ap.add_argument("--db", help="the SQLite file (default: DB_PATH)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    ls = sub.add_parser("list")
    ls.add_argument("--hidden", action="store_true", help="only hidden ones")
    ls.add_argument("--thread")
    for name in ("hide", "restore", "delete"):
        sub.add_parser(name).add_argument("id", type=int)
    args = ap.parse_args(argv)
    path = Path(args.db) if args.db else Settings().db_path  # type: ignore[call-arg]
    with sqlite3.connect(path) as db:
        now = time.time()
        if args.cmd == "list":
            q = (
                "select id, thread, nickname, tag, body, created_at, hidden_reason,"
                " (select count(*) from comment_reports r where r.comment_id = c.id)"
                " from comments c where deleted_at is null"
            )
            params: list[object] = []
            if args.hidden:
                q += " and hidden_at is not null"
            if args.thread:
                q += " and thread = ?"
                params.append(args.thread)
            for cid, thread, nick, tag, body, at, hidden, reports in db.execute(
                q + " order by created_at desc limit 200", params
            ):
                when = datetime.fromtimestamp(at, UTC).strftime("%m-%d %H:%M")
                flag = f" [hidden: {hidden}]" if hidden else ""
                print(f"#{cid} {when} {thread} {nick}({tag}) reports={reports}{flag}: {body}")
            return 0
        sql = {
            "hide": (
                "update comments set hidden_at = ?, hidden_reason = 'admin' where id = ?",
                (now, args.id),
            ),
            "restore": (
                "update comments set hidden_at = null, hidden_reason = null where id = ?",
                (args.id,),
            ),
            "delete": ("update comments set deleted_at = ? where id = ?", (now, args.id)),
        }[args.cmd]
        changed = db.execute(*sql).rowcount
        if args.cmd == "restore":
            db.execute("delete from comment_reports where comment_id = ?", (args.id,))
        print(f"{args.cmd} #{args.id}: {'ok' if changed else 'no such comment'}")
        return 0 if changed else 1


if __name__ == "__main__":
    sys.exit(main())
