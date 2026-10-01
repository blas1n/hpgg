"""The FastAPI application: settings, JSON logs, one SQLite database, one router per feature.

Adding a feature (accounts, community): a package under `server/` with its router, tables on
`server.db.Base` (imported in `server/models.py`) and an Alembic revision; include the router here.
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any

import httpx
import structlog
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from server.config import Settings
from server.db import Database, migrate
from server.errors import on_validation_error
from server.players.hp import HPClient
from server.players.matches import MatchService
from server.players.privacy import PrivacyFeed
from server.players.replay_router import router as replays_router
from server.players.replays import ReplayService
from server.players.router import router as players_router
from server.players.service import PlayerService
from server.players.store import HPStore
from server.ratelimit import SlidingWindowLimiter

log = structlog.get_logger(__name__)


def create_app(
    settings: Settings,
    *,
    hp_transport: httpx.AsyncBaseTransport | None = None,
    clock: Callable[[], float] = time.time,
    privacy_poll: bool = True,
) -> FastAPI:
    """`privacy_poll=False` is for tests only: the feed poll is a licence condition (terms §5)."""

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        await asyncio.to_thread(migrate, settings.db_path)
        db = Database(settings.db_path)
        http = httpx.AsyncClient(transport=hp_transport, timeout=settings.request_timeout)
        hp = HPClient(
            base_url=settings.hp_base_url,
            token=settings.hp_api_token.get_secret_value(),
            http=http,
            clock=clock,
        )
        store = HPStore(db)
        app.state.players = PlayerService(hp=hp, store=store, settings=settings, clock=clock)
        app.state.matches = MatchService(
            hp=hp, store=store, players=app.state.players, settings=settings, clock=clock
        )
        app.state.replays = ReplayService(hp=hp, store=store, settings=settings, clock=clock)
        app.state.privacy = PrivacyFeed(hp=hp, store=store, settings=settings, clock=clock)
        poller = asyncio.create_task(app.state.privacy.run_forever()) if privacy_poll else None
        app.state.ip_limiter = SlidingWindowLimiter(settings.ip_requests_per_minute, 60.0, clock)
        log.info("server.started", db=str(settings.db_path), origins=settings.cors_origins)
        try:
            yield
        finally:
            if poller is not None:
                poller.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await poller
            await hp.aclose()
            await db.dispose()

    app = FastAPI(
        title="HPGG API", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET"],
        allow_headers=[],
        max_age=3600,
    )
    app.add_exception_handler(RequestValidationError, on_validation_error)

    @app.middleware("http")
    async def access_log(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        started = time.perf_counter()
        response = await call_next(request)
        log.info(
            "http.request",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            ms=round((time.perf_counter() - started) * 1000, 1),
        )
        return response

    @app.get("/healthz")
    async def healthz(request: Request) -> JSONResponse:
        service: PlayerService = request.app.state.players
        feed: PrivacyFeed = request.app.state.privacy
        body: dict[str, Any] = {
            "ok": True,
            "quota": {
                **await service.status(),
                **await request.app.state.matches.status(),
                **await request.app.state.replays.status(),
            },
            "privacy": await feed.status(),
        }
        return JSONResponse(body, headers={"Cache-Control": "no-store"})

    app.include_router(players_router)
    app.include_router(replays_router)
    return app
