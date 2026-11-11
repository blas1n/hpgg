"""The owner's MCP server: six read-only tools over the owner's games, hero pool and the site's
high-tier baseline, behind HP-GG's own OAuth (`oauth.py`).

Every answer is data, not judgement: counts, sums and HP's own fields. Nothing here scores a game
or a player. A refresh from HP runs before each answer when the stored games are older than
`mcp_sync_interval_seconds` (`games.py`).
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Annotated, Any, Literal

from mcp.server.auth.settings import AuthSettings, ClientRegistrationOptions, RevocationOptions
from mcp.server.mcpserver import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from pydantic import Field
from sqlalchemy import select
from starlette.applications import Starlette

from server.accounts.models import Account
from server.accounts.pool import PoolService
from server.config import Settings
from server.db import Database
from server.mcp.games import LIMITS, Game, OwnerGames
from server.mcp.hero import hero_page
from server.mcp.names import GameNames
from server.mcp.oauth import SCOPE, OwnerOAuthProvider
from server.mcp.tiers import FORMULA, compute_tiers, load_view, snapshot_key
from server.players.service import PlayerService

READ_ONLY = ToolAnnotations(read_only_hint=True, destructive_hint=False, open_world_hint=False)
GroupBy = Literal[
    "hero", "map", "role", "map_hero", "first_pick", "pick_order", "party_size", "first_to_ten"
]
# summed per group; `<stat>_games` counts the games where HP gave the stat (healing can be null)
SUMS = (
    "kills", "deaths", "assists", "hero_damage", "siege_damage", "structure_damage",
    "experience_contribution", "healing", "self_healing", "damage_taken", "protection_allies",
    "time_spent_dead", "merc_camp_captures", "stunning_enemies", "rooting_enemies",
    "silencing_enemies",
)  # fmt: skip

Services = Callable[[], tuple[OwnerGames, PlayerService, PoolService, Database]]


def build_mcp(settings: Settings, provider: OwnerOAuthProvider, services: Services) -> MCPServer:
    issuer = settings.api_url
    mcp = MCPServer(
        "hpgg",
        title="HP-GG 내 전적",
        instructions=(
            "The owner's Heroes of the Storm Storm League games from Heroes Profile, read-only. "
            "Start with get_status for coverage and limits. Hero and map names may be English or "
            "Korean. Fields ending in _derived are computed from observed fields; null means HP "
            "did not record it. Always keep the game counts next to any rate."
        ),
        auth_server_provider=provider,
        auth=AuthSettings(
            issuer_url=issuer,  # type: ignore[arg-type]
            resource_server_url=f"{issuer}/mcp",  # type: ignore[arg-type]
            validate_token_resource=True,
            required_scopes=[SCOPE],
            client_registration_options=ClientRegistrationOptions(
                enabled=True, valid_scopes=[SCOPE], default_scopes=[SCOPE]
            ),
            revocation_options=RevocationOptions(enabled=True),
        ),
    )

    def filters(
        games: OwnerGames,
        hero: str | None,
        map: str | None,
        role: str | None,
        result: str | None,
        since: str | None,
        until: str | None,
    ) -> tuple[Callable[[Game], bool], str | None]:
        n = games.names
        h = n.hero(hero) if hero else None
        if hero and h is None:
            return (lambda g: False), "unknown_hero"
        m = n.map(map) if map else None
        if map and m is None:
            return (lambda g: False), "unknown_map"
        r = n.role(role) if role else None
        if role and r is None:
            return (lambda g: False), "unknown_role"

        def keep(g: Game) -> bool:
            row = g.row
            date = str(row["date"] or "")
            return (
                (h is None or row["hero"] == h)
                and (m is None or row["map"] == m)
                and (r is None or row["role"] == r)
                and (result is None or row["win"] == (result == "win"))
                and (since is None or date >= since)
                and (until is None or date <= until)
            )

        return keep, None

    @mcp.tool(annotations=READ_ONLY)
    async def get_status() -> dict[str, Any]:
        """Coverage first: the owner, current Storm League rank from Heroes Profile, how many
        games are stored and from when, the refresh state, and the data's known limits."""
        games, players, _, _ = services()
        await games.ensure_fresh()
        stored = await games.all()
        looked = await players.lookup(settings.mcp_owner_battletag, settings.mcp_owner_region)
        sl = None
        if looked.outcome == "ok" and looked.profile:
            sl = next((m for m in looked.profile.get("modes", []) if m.get("mode") == "sl"), None)
        dates = [str(g.row["date"]) for g in stored if g.row["date"]]
        return {
            "owner": settings.mcp_owner_battletag,
            "region": settings.mcp_owner_region,
            "mode": "sl",
            "storm_league": sl,
            "profile_source": looked.outcome,
            "games_stored": len(stored),
            "first_game": min(dates) if dates else None,
            "last_game": max(dates) if dates else None,
            "sync": await games.sync_status(),
            "limits": LIMITS,
        }

    @mcp.tool(annotations=READ_ONLY)
    async def list_matches(
        hero: Annotated[str | None, Field(description="English or Korean hero name")] = None,
        map: Annotated[str | None, Field(description="English or Korean map name")] = None,
        role: Annotated[str | None, Field(description="Tank, Bruiser, Healer, … or Korean")] = None,
        result: Literal["win", "loss"] | None = None,
        since: Annotated[
            str | None, Field(description="'YYYY-MM-DD[ HH:MM:SS]', inclusive")
        ] = None,
        until: Annotated[
            str | None, Field(description="'YYYY-MM-DD[ HH:MM:SS]', inclusive")
        ] = None,
        limit: Annotated[int, Field(ge=1, le=200)] = 50,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> dict[str, Any]:
        """The owner's Storm League games, newest first: map, hero, result, length, K/D/A, the
        full stat line, talents, MMR change, both teams' heroes and bans, draft position."""
        games, _, _, _ = services()
        await games.ensure_fresh()
        keep, err = filters(games, hero, map, role, result, since, until)
        picked = [g for g in await games.all() if keep(g)]
        out: dict[str, Any] = {
            "total": len(picked),
            "offset": offset,
            "matches": [games.flat(g) for g in picked[offset : offset + limit]],
        }
        if err:
            out["error"] = err
        return out

    @mcp.tool(annotations=READ_ONLY)
    async def get_match(match_id: int) -> dict[str, Any]:
        """One stored game in full: all ten players' stat lines and talents (other players as
        player_1…player_9, no BattleTags), bans, the draft order and team XP per minute."""
        games, _, _, _ = services()
        await games.ensure_fresh()
        found = await games.detail(match_id)
        return found if found is not None else {"error": "not_found", "match_id": match_id}

    @mcp.tool(annotations=READ_ONLY)
    async def summarize(
        group_by: GroupBy,
        hero: str | None = None,
        map: str | None = None,
        role: str | None = None,
        result: Literal["win", "loss"] | None = None,
        since: str | None = None,
        until: str | None = None,
    ) -> dict[str, Any]:
        """Counts and sums of the owner's games per group: games, wins, losses, win_rate, K/D/A,
        (K+A)/D, stat sums and total game seconds (to normalise per minute). first_pick,
        pick_order and party_size are derived from the draft; null = not known for those games."""
        games, _, _, _ = services()
        await games.ensure_fresh()
        keep, err = filters(games, hero, map, role, result, since, until)
        groups: dict[Any, list[dict[str, Any]]] = {}
        for g in await games.all():
            if not keep(g):
                continue
            row = games.flat(g)
            groups.setdefault(_group_key(group_by, row), []).append(row)
        rows = [{"key": k, **_sums(v)} for k, v in groups.items()]
        rows.sort(key=lambda r: (-r["games"], str(r["key"])))
        out: dict[str, Any] = {"group_by": group_by, "rows": rows}
        if err:
            out["error"] = err
        return out

    @mcp.tool(annotations=READ_ONLY)
    async def get_hero_pool() -> dict[str, Any]:
        """The hero pool the owner keeps on hpgg.win (밴픽 page), in the owner's order."""
        games, _, pool, db = services()
        async with db.session() as s:
            account_id = (
                await s.execute(
                    select(Account.id).where(Account.battletag == settings.mcp_owner_battletag)
                )
            ).scalar_one_or_none()
        heroes = await pool.heroes(account_id) if account_id is not None else []
        n = games.names
        return {
            "heroes": [{"hero": h, "hero_ko": n.hero_ko(h), "role": n.hero_role(h)} for h in heroes]
        }

    @mcp.tool(annotations=READ_ONLY)
    async def get_baseline(
        hero: Annotated[str | None, Field(description="English or Korean; omit for all")] = None,
        region: Literal["all", "kr"] = "all",
    ) -> dict[str, Any]:
        """HP-GG's high-tier Storm League numbers to compare against: a hero's win rate overall
        and per map (games kept), and Storm League average stats per hero (all ranks). region
        "kr" is Korea only, a much smaller sample."""
        games, _, _, _ = services()
        return _baseline(settings.site_data_dir, games.names, hero, region)

    @mcp.tool(annotations=READ_ONLY)
    async def get_tier_list(
        mode: Literal["sl", "qm", "ar"] = "sl",
        bracket: Annotated[
            Literal["all", "low", "high"],
            Field(description="Storm League only: low = bronze–platinum, high = diamond+"),
        ] = "all",
        region: Literal["all", "kr", "na", "eu"] = "all",
        map: Annotated[str | None, Field(description="English or Korean map name")] = None,
        role: Annotated[str | None, Field(description="filter shown heroes; ranks stay")] = None,
    ) -> dict[str, Any]:
        """HP-GG's tier table (hpgg.win) for one view: each hero's tier S–F, rank, score, win
        rate, pick and ban rate, games; heroes under the sample floor are listed as unranked.
        Same formula, files and reference patch as the site."""
        games, _, _, _ = services()
        return _tier_list(settings.site_data_dir, games.names, mode, bracket, region, map, role)

    @mcp.tool(annotations=READ_ONLY)
    async def get_hero(
        hero: Annotated[str, Field(description="English or Korean hero name")],
        mode: Literal["sl", "qm"] = "sl",
        bracket: Annotated[
            Literal["all", "low", "high"],
            Field(description="Storm League only: low = bronze–platinum, high = diamond+"),
        ] = "all",
        region: Literal["all", "kr", "na", "eu"] = "all",
        map: Annotated[str | None, Field(description="English or Korean map name")] = None,
    ) -> dict[str, Any]:
        """Everything hpgg.win's hero page shows for one hero: tier, rank (and change since the
        previous patch), win/pick/ban rate in the view; win rate per map; every region × bracket;
        win rate per league and per game length; counters and synergies; top talent builds;
        recent patch notes and hotfixes. `rules` says the thresholds each section uses."""
        games, _, _, _ = services()
        n = games.names
        h = n.hero(hero)
        if h is None:
            return {"error": "unknown_hero", "hero": hero}
        m = n.map(map) if map else "all"
        if m is None:
            return {"error": "unknown_map", "map": map}
        b = bracket if mode == "sl" else "all"
        return hero_page(settings.site_data_dir, n, h, mode, b, region, m)

    return mcp


def _tier_list(
    data_dir: Path,
    names: GameNames,
    mode: str,
    bracket: str,
    region: str,
    map_name: str | None,
    role_name: str | None,
) -> dict[str, Any]:
    if mode != "sl":
        bracket = "all"
    if mode == "ar":
        region, map_name = "all", None
    m = names.map(map_name) if map_name else "all"
    if m is None:
        return {"error": "unknown_map", "map": map_name}
    r = names.role(role_name) if role_name else None
    if role_name and r is None:
        return {"error": "unknown_role", "role": role_name}
    meta, snap = load_view(data_dir, snapshot_key(mode, bracket, region))
    want_region = None if region == "all" else region.upper()
    if not snap or (snap.get("region") or None) != want_region:
        return {"error": "view_unavailable"}
    min_games = int(meta.get("min_games_for_tier") or 50)
    rows = [
        x
        for x in snap.get("rows", [])
        if isinstance(x, dict) and x.get("map") == m and names.hero_ko(x.get("hero"))
    ]
    result = compute_tiers(rows, min_games)

    def shown(hero: str) -> bool:
        return r is None or names.hero_role(hero) == r

    return {
        "view": {"mode": mode, "bracket": bracket, "region": region, "map": m},
        "patch": snap.get("patch"),
        "collected_at": snap.get("collected_at"),
        "league_tier": snap.get("league_tier"),
        "matches": snap.get("matches")
        if m == "all"
        else round(sum(int(x["games"]) for x in rows) / 10),
        "min_games": min_games,
        "party_corrected": bool(snap.get("party")) and any("tier_win_rate" in x for x in rows),
        "formula": FORMULA,
        "heroes": [
            {
                "hero": x.hero,
                "hero_ko": names.hero_ko(x.hero),
                "role": names.hero_role(x.hero),
                "tier": x.tier,
                "rank": x.rank,
                "score": round(x.score, 2),
                "win_rate": x.row.get("win_rate"),
                "pick": x.row.get("pick"),
                "ban_rate": x.row.get("ban_rate"),
                "games": x.row.get("games"),
            }
            for x in result.ranked
            if shown(x.hero)
        ],
        "unranked": [
            {"hero": x["hero"], "hero_ko": names.hero_ko(x["hero"]), "games": x["games"]}
            for x in rows
            if x["games"] < min_games and shown(x["hero"])
        ],
    }


def mcp_app(mcp: MCPServer, settings: Settings) -> Starlette:
    return mcp.streamable_http_app(
        streamable_http_path="/mcp",
        stateless_http=True,
        json_response=True,
        transport_security=TransportSecuritySettings(
            allowed_hosts=settings.mcp_allowed_hosts,
            allowed_origins=["https://chatgpt.com", settings.api_url],
        ),
    )


def _group_key(group_by: str, row: dict[str, Any]) -> Any:
    return {
        "hero": row["hero"],
        "map": row["map"],
        "role": row["role"],
        "map_hero": f"{row['map']} / {row['hero']}",
        "first_pick": row["my_team_first_pick_derived"],
        "pick_order": row["my_pick_within_team_derived"],
        "party_size": row["party_size_derived"],
        "first_to_ten": row["first_to_ten"],
    }[group_by]


def _sums(rows: list[dict[str, Any]]) -> dict[str, Any]:
    games = len(rows)
    wins = sum(1 for r in rows if r["win"])
    timed = [r["game_length_s"] for r in rows if r["game_length_s"] is not None]
    out: dict[str, Any] = {
        "games": games,
        "wins": wins,
        "losses": games - wins,
        "win_rate": round(wins / games * 100, 2) if games else None,
        "games_with_length": len(timed),
        "total_game_seconds": sum(timed),
    }
    for k in SUMS:
        values = [r["stats"].get(k) for r in rows if r["stats"].get(k) is not None]
        out[k] = sum(values)
        out[f"{k}_games"] = len(values)
    deaths = out["deaths"]
    out["kda_(k+a)/d"] = round((out["kills"] + out["assists"]) / deaths, 2) if deaths else None
    return out


def _d(x: Any) -> dict[str, Any]:
    return x if isinstance(x, dict) else {}


def _read(path: Path) -> dict[str, Any]:
    try:
        data: Any = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _baseline(data_dir: Path, names: GameNames, hero: str | None, region: str) -> dict[str, Any]:
    h = names.hero(hero) if hero else None
    if hero and h is None:
        return {"error": "unknown_hero", "hero": hero}
    tiers = _read(data_dir / "latest" / ("sl_high_kr.json" if region == "kr" else "sl_high.json"))
    averages = _read(data_dir / "latest" / "sl_averages.json")
    if not tiers:
        return {"error": "baseline_unavailable"}
    rows = [r for r in tiers.get("rows", []) if isinstance(r, dict)]
    keep = ("games", "wins", "losses", "win_rate", "ban_rate", "popularity")

    def rate(r: dict[str, Any]) -> dict[str, Any]:
        return {k: r.get(k) for k in keep}

    out: dict[str, Any] = {
        "patch": tiers.get("patch"),
        "bracket": {
            "league_tier": tiers.get("league_tier"),
            "region": tiers.get("region"),
            "collected_at": tiers.get("collected_at"),
            "games_in_bracket": tiers.get("matches"),
        },
        "average_stats_scope": "Storm League, all ranks, " + str(averages.get("builds")),
    }
    stats = _d(averages.get("stats"))
    if h is None:
        out["heroes"] = [
            {"hero": r["hero"], "hero_ko": names.hero_ko(r["hero"]), **rate(r)}
            for r in rows
            if r.get("map") == "all"
        ]
        return out
    mine = [r for r in rows if r.get("hero") == h]
    overall = next((r for r in mine if r.get("map") == "all"), None)
    out.update(
        hero=h,
        hero_ko=names.hero_ko(h),
        win_rate={
            "all": rate(overall) if overall else None,
            "by_map": {r["map"]: rate(r) for r in mine if r.get("map") != "all"},
        },
        average_stats={k: v.get(h) for k, v in stats.items() if isinstance(v, dict)},
        average_stats_games=_d(averages.get("games")).get(h),
    )
    return out
