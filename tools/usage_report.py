"""How many people used hpgg.win: the numbers for the portfolio README, taken on shutdown day.

Run on the Mac mini before the API's database and the GoatCounter site are deleted
(docs/SHUTDOWN-2026-11-28.md):

    uv run python -m tools.usage_report --env deploy/.env --end 2026-11-28

It reads page views from the GoatCounter API (GOATCOUNTER_TOKEN) and totals from the API's SQLite
database inside the running container, then writes docs/usage/usage.json,
docs/usage/daily-visits.svg and the README's usage section. Only totals leave the service: the
database query reads counts and dates, never a BattleTag, an IP hash, a comment or a cache key.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import httpx
import structlog
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = structlog.get_logger(__name__)

ROOT = Path(__file__).resolve().parents[1]
START = "2026-09-28"  # the first day hpgg.win was public
MARK_START, MARK_END = "<!-- usage:start -->", "<!-- usage:end -->"

# Counts and dates only. Runs as `python -c` inside the API container (its SQLite volume).
DB_QUERY = """
import json, sqlite3
c = sqlite3.connect("/data/hpgg.sqlite")
one = lambda q: c.execute(q).fetchone()[0]
print(json.dumps({
    "accounts": one("select count(*) from accounts"),
    "first_signup": one("select date(min(created_at), 'unixepoch') from accounts"),
    "pool_users": one("select count(distinct account_id) from hero_pool"),
    "comments": one("select count(*) from comments where deleted_at is null"),
    "calls": dict(c.execute(
        "select endpoint, sum(live_calls) from hp_daily_usage group by endpoint"
    )),
}))
"""


class Settings(BaseSettings):
    goatcounter_token: SecretStr = SecretStr("")
    goatcounter_url: str = "https://hpgg.goatcounter.com/api/v0"
    api_container: str = "hpgg-api"

    model_config = SettingsConfigDict(extra="ignore")


@dataclass
class Usage:
    start: str
    end: str
    days: int
    visits: int
    daily: list[tuple[str, int]]
    peak: tuple[str, int]
    weekly: list[tuple[str, int]]
    languages: dict[str, int]
    devices: dict[str, int]
    countries: list[tuple[str, int]]
    accounts: int
    first_signup: str | None
    pool_users: int
    comments: int
    player_lookups: int
    replay_lookups: int
    calls: dict[str, int] = field(default_factory=dict)


def _days(start: str, end: str) -> list[str]:
    a, b = date.fromisoformat(start), date.fromisoformat(end)
    return [(a + timedelta(n)).isoformat() for n in range((b - a).days + 1)]


def summarize(
    total: dict[str, Any],
    hits: dict[str, Any],
    locations: dict[str, Any],
    sizes: dict[str, Any],
    db: dict[str, Any],
    *,
    start: str,
    end: str,
) -> Usage:
    """The figures the README shows, from the GoatCounter answers and the database totals."""
    by_day = {s["day"]: s["daily"] for s in total.get("stats", [])}
    daily = [(d, by_day.get(d, 0)) for d in _days(start, end)]
    weeks: dict[str, int] = {}
    for d, n in daily:
        monday = date.fromisoformat(d) - timedelta(date.fromisoformat(d).weekday())
        weeks[monday.isoformat()] = weeks.get(monday.isoformat(), 0) + n
    pages = [h for h in hits.get("hits", []) if not h.get("event")]
    languages = {
        lang: sum(h["count"] for h in pages if h["path"].startswith(f"/{lang}/"))
        for lang in ("ko", "en")
    }
    size = {s["id"]: s["count"] for s in sizes.get("stats", [])}
    calls = {k: int(v or 0) for k, v in (db.get("calls") or {}).items()}
    return Usage(
        start=start,
        end=end,
        days=len(daily),
        visits=int(total.get("total", sum(n for _, n in daily))),
        daily=daily,
        peak=max(daily, key=lambda dn: dn[1]),
        weekly=list(weeks.items()),
        languages=languages,
        devices={
            "phone": size.get("phone", 0),
            "tablet": size.get("tablet", 0),
            "desktop": size.get("desktop", 0) + size.get("desktophd", 0),
        },
        countries=[(s["name"], s["count"]) for s in locations.get("stats", [])],
        accounts=int(db.get("accounts", 0)),
        first_signup=db.get("first_signup"),
        pool_users=int(db.get("pool_users", 0)),
        comments=int(db.get("comments", 0)),
        player_lookups=calls.get("players", 0),
        replay_lookups=calls.get("replay_data", 0),
        calls=calls,
    )


def _pct(n: int, total: int) -> str:
    return f"{n / total * 100:.0f}%" if total else "0%"


def render_markdown(u: Usage) -> str:
    """The README's usage section (English, like the rest of the README)."""
    korea = u.countries[0] if u.countries else ("—", 0)
    lang_total = sum(u.languages.values())
    dev_total = sum(u.devices.values())
    weekly_peak = max(u.weekly, key=lambda wn: wn[1]) if u.weekly else ("—", 0)
    return "\n".join(
        [
            MARK_START,
            "## Usage",
            "",
            f"Live from {u.start} to {u.end} ({u.days} days).",
            "",
            "| | |",
            "|---|---|",
            f"| Page views | {u.visits:,} (busiest day {u.peak[0]}: {u.peak[1]:,}; "
            f"busiest week from {weekly_peak[0]}: {weekly_peak[1]:,}) |",
            f"| Where from | {korea[0]} {_pct(korea[1], u.visits)} |",
            f"| Language | Korean {_pct(u.languages.get('ko', 0), lang_total)}, "
            f"English {_pct(u.languages.get('en', 0), lang_total)} |",
            f"| Device | desktop {_pct(u.devices['desktop'], dev_total)}, "
            f"phone {_pct(u.devices['phone'], dev_total)}, "
            f"tablet {_pct(u.devices['tablet'], dev_total)} |",
            f"| Player searches | {u.player_lookups:,} player profiles looked up |",
            f"| Battle.net accounts | {u.accounts:,} (sign-in opened {u.first_signup}), "
            f"{u.pool_users:,} kept a hero pool |",
            f"| Comments | {u.comments:,} |",
            "",
            "![Daily page views](docs/usage/daily-visits.svg)",
            "",
            "Page views are GoatCounter's (one per page per visit, no cookies); searches and "
            "accounts are the API's own totals, taken on shutdown day before its database was "
            "deleted.",
            MARK_END,
        ]
    )


def render_svg(u: Usage, width: int = 720, height: int = 180) -> str:
    """Daily page views as bars; readable on GitHub's light and dark themes."""
    pad_l, pad_b, pad_t = 40, 22, 10
    top = max((n for _, n in u.daily), default=0) or 1
    bw = (width - pad_l - 4) / max(len(u.daily), 1)
    bars = []
    for i, (d, n) in enumerate(u.daily):
        h = (height - pad_b - pad_t) * n / top
        x = pad_l + i * bw
        y = height - pad_b - h
        bars.append(
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{max(bw - 1, 1):.1f}" height="{h:.1f}">'
            f"<title>{d}: {n}</title></rect>"
        )
    first, last = u.daily[0][0] if u.daily else "", u.daily[-1][0] if u.daily else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="{width}" height="{height}" role="img" aria-label="Daily page views">'
        "<style>rect{fill:#2f80c9}text{fill:#55607a;font:11px sans-serif}"
        "@media (prefers-color-scheme: dark){rect{fill:#4fd1ff}text{fill:#8691ac}}</style>"
        f'<text x="{pad_l - 6}" y="{pad_t + 8}" text-anchor="end">{top:,}</text>'
        f'<text x="{pad_l - 6}" y="{height - pad_b}" text-anchor="end">0</text>'
        f"{''.join(bars)}"
        f'<text x="{pad_l}" y="{height - 6}">{first}</text>'
        f'<text x="{width - 4}" y="{height - 6}" text-anchor="end">{last}</text>'
        "</svg>"
    )


def update_readme(readme: str, section: str) -> str:
    """Replace the usage section, or put it before "## What it did" the first time."""
    if MARK_START in readme and MARK_END in readme:
        head, rest = readme.split(MARK_START, 1)
        return head + section + rest.split(MARK_END, 1)[1]
    anchor = "## What it did"
    if anchor in readme:
        return readme.replace(anchor, section + "\n\n" + anchor, 1)
    return readme.rstrip() + "\n\n" + section + "\n"


async def _goatcounter(s: Settings, start: str, end: str) -> dict[str, Any]:
    span = {"start": f"{start}T00:00:00Z", "end": f"{end}T23:59:59Z"}
    headers = {"Authorization": f"Bearer {s.goatcounter_token.get_secret_value()}"}
    async with httpx.AsyncClient(base_url=s.goatcounter_url, headers=headers, timeout=30) as c:

        async def get(path: str, **params: Any) -> dict[str, Any]:
            # GoatCounter allows 4 requests a second: pace them, and wait out a 429 or a dropped
            # connection (it closes the socket when the limit is hit) a few times
            for attempt in range(5):
                await asyncio.sleep(0.3 + attempt)
                try:
                    r = await c.get(path, params={**span, **params})
                except httpx.TransportError:
                    continue
                if r.status_code == 429:
                    continue
                r.raise_for_status()
                data: dict[str, Any] = r.json()
                return data
            raise RuntimeError(f"GoatCounter {path} kept failing")

        hits: list[dict[str, Any]] = []
        while True:  # every page: the language split needs all of them
            # comma-separated: repeated exclude_paths parameters are ignored (the same page again)
            seen = ",".join(str(h["path_id"]) for h in hits)
            page = await get("/stats/hits", limit=100, **({"exclude_paths": seen} if seen else {}))
            new = [
                h for h in page.get("hits", []) if h["path_id"] not in {x["path_id"] for x in hits}
            ]
            hits += new
            if not page.get("more") or not new:
                break
        return {
            "total": await get("/stats/total"),
            "hits": {"hits": hits},
            "locations": await get("/stats/locations", limit=10),
            "sizes": await get("/stats/sizes"),
        }


async def _db(s: Settings) -> dict[str, Any]:
    proc = await asyncio.create_subprocess_exec(
        "docker", "exec", s.api_container, "python", "-c", DB_QUERY,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )  # fmt: skip
    out, err = await proc.communicate()
    if proc.returncode:
        raise RuntimeError(f"database totals failed: {err.decode()[-300:]}")
    data: dict[str, Any] = json.loads(out)
    return data


async def run(env: Path, end: str) -> Usage:
    s = Settings(_env_file=env)  # type: ignore[call-arg]
    gc, db = await asyncio.gather(_goatcounter(s, START, end), _db(s))
    u = summarize(gc["total"], gc["hits"], gc["locations"], gc["sizes"], db, start=START, end=end)
    out = ROOT / "docs" / "usage"
    out.mkdir(parents=True, exist_ok=True)
    (out / "usage.json").write_text(json.dumps(asdict(u), indent=1) + "\n", encoding="utf-8")
    (out / "daily-visits.svg").write_text(render_svg(u) + "\n", encoding="utf-8")
    readme = ROOT / "README.md"
    readme.write_text(update_readme(readme.read_text("utf-8"), render_markdown(u)), "utf-8")
    logger.info("usage_report_written", visits=u.visits, accounts=u.accounts, days=u.days)
    return u


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else None)
    p.add_argument("--env", type=Path, default=ROOT / "deploy" / ".env")
    p.add_argument("--end", default=date.today().isoformat())
    a = p.parse_args(argv)
    asyncio.run(run(a.env, a.end))
    return 0


if __name__ == "__main__":
    sys.exit(main())
