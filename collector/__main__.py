"""`uv run python -m collector` — one daily run. Exit code 0 on success, 1 on any failure."""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys

import structlog

from collector.config import Settings
from collector.run import run, run_backfill_previous


def configure_logging(level: str) -> None:
    """Explicit JSON logging for a daemon/cron process (never the dev ConsoleRenderer)."""
    logging.basicConfig(format="%(message)s", stream=sys.stderr, level=level.upper())
    logging.getLogger("httpx").setLevel(logging.WARNING)  # its INFO line echoes full URLs
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(ensure_ascii=False),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(level.upper())),
        logger_factory=structlog.PrintLoggerFactory(sys.stderr),
        cache_logger_on_first_use=False,
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="collector", description="hotsmeta daily collector")
    ap.add_argument(
        "--previous",
        metavar="PATCH",
        help="one-off: collect this older patch, every build of it, into data/previous/ "
        "(e.g. 2.55.17; the whole cube, 24 calls)",
    )
    ap.add_argument(
        "--only",
        metavar="VIEWS",
        help="recovery: only these views (qm,sl[,sl_low,sl_high]), each in every region; "
        "qm,sl with the party correction is 12 Heroes/Stats calls",
    )
    args = ap.parse_args(argv)
    settings = Settings()  # type: ignore[call-arg]  # hp_api_token comes from env/.env
    configure_logging(settings.log_level)
    if args.previous:
        return asyncio.run(run_backfill_previous(settings, patch=args.previous))
    if args.only:
        return asyncio.run(run(settings, only=tuple(v.strip() for v in args.only.split(","))))
    return asyncio.run(run(settings))


if __name__ == "__main__":
    sys.exit(main())
