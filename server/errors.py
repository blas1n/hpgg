"""One error shape for every route: `{"error": {"code", "message"}}` (the same envelope HP uses)."""

from __future__ import annotations

import math

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


def error(status: int, code: str, message: str, retry_after: float | None = None) -> JSONResponse:
    headers = {"Cache-Control": "no-store"}
    if retry_after is not None:
        headers["Retry-After"] = str(max(1, math.ceil(retry_after)))
    return JSONResponse(
        status_code=status, content={"error": {"code": code, "message": message}}, headers=headers
    )


async def on_validation_error(_request: Request, exc: Exception) -> JSONResponse:
    fields = []
    if isinstance(exc, RequestValidationError):
        fields = sorted({str(e["loc"][-1]) for e in exc.errors() if e.get("loc")})
    return error(422, "invalid_parameters", "잘못된 입력: " + ", ".join(fields))
