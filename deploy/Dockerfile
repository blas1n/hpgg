# HPGG API (api.hpgg.win). Build context = repo root: docker build -f deploy/Dockerfile .
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.10.4 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:$PATH

WORKDIR /app
# Dependencies first (cached until pyproject/uv.lock change), then the server package only.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY server/ server/

# Non-root; /data is the named volume (SQLite). A fresh named volume copies this directory's owner.
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin hpgg \
    && mkdir -p /data && chown hpgg:hpgg /data
USER hpgg
ENV DB_PATH=/data/hpgg.sqlite

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=4)"]
CMD ["python", "-m", "server"]
