"""`python -m server` — serve the API with uvicorn, JSON logs, no uvicorn log config of its own."""

from __future__ import annotations

import sys

import uvicorn

from server.app import create_app
from server.config import Settings
from server.logs import configure_logging


def main() -> int:
    settings = Settings()  # type: ignore[call-arg]  # hp_api_token comes from env / .env
    configure_logging(settings.log_level)
    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        log_config=None,  # our JSON root handler renders uvicorn's records too
        access_log=False,  # the app logs one structured line per request instead
        proxy_headers=False,  # the client IP comes from CF-Connecting-IP (see ratelimit.client_ip)
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
