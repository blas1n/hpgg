"""`uv run python -m collector` — one daily run. Exit code 0 on success, 1 on any failure."""

from __future__ import annotations

import asyncio
import logging
import sys

import structlog

from collector.config import Settings
from collector.run import run


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


def main() -> int:
    settings = Settings()  # type: ignore[call-arg]  # hp_api_token comes from env/.env
    configure_logging(settings.log_level)
    return asyncio.run(run(settings))


if __name__ == "__main__":
    sys.exit(main())
