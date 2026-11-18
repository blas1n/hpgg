"""Synthetic test fixtures: the shape of Heroes Profile responses without HP's data.

hpgg.win shut down on 2026-11-28 and the repository stays public as a portfolio. HP's API terms
forbid giving its data to others (§3) and require deleting it when the licence ends (§9), so the
fixtures that came from HP are rewritten by this tool and their old contents are removed from
history (docs/SHUTDOWN-2026-11-28.md).

What changes: every number HP measured (games, wins, rates, damage, MMR, ...) is drawn again at
random, keeping only its number of digits; counts that belong together (wins + losses = games, win
rate = wins / games) are made to agree again. Player identities (BattleTags, Blizzard ids, replay
ids, fingerprints) become fake ones, the same fake for the same real one across every file. What
stays: game facts that are not HP's measurements (hero, map and talent names and ids, levels,
regions, patch versions, dates).

    uv run python -m tools.synth_fixtures <file> [<file> ...]   # rewrites the files in place
"""

from __future__ import annotations

import gzip
import hashlib
import json
import random
import re
import sys
from pathlib import Path
from typing import Any

# Numbers under these keys are game facts or enumerations, not measurements.
_KEEP = {
    "id",
    "k",
    "level",
    "region",
    "team",
    "winner",
    "tier",
    "tiers",
    "league_tier",
    "season",
    "year",
    "parser",
    "build",
    "slot",
    "player_slot",
    "sort",
    "order",
    "position",
    "min_games",
    "min_games_for_tier",
    "ci",
    "pick_order",
    "type",
    "status",
    "status_code",
}
# Game facts noticed after the first generation: still drawn and dropped, so keeping them does not
# move every number drawn after them (tests pin those numbers).
_KEEP_DRAWN = {"pick_number", "game_map", "type_role_hero"}
_PAGING = ("per_page", "total", "current_page", "last_page", "from", "to")
_OWN_RATE = {"win_rate", "tier_win_rate", "winrate", "solo_pooled"}
_IDENTITY_INT = {"blizz_id", "replayID", "replay_id", "max_replay_id", "next_after", "after"}
_TAG = re.compile(r"\b([^\s\"#{}\[\],:]{2,24})#(\d{3,6})\b")
_GAMES = ("games", "games_played", "matches")


def _keep_key(key: str) -> bool:
    k = key.lower()
    return k in _KEEP or k.endswith("id") or "talent" in k


def _rate_key(key: str) -> bool:
    """The record's own win rate; `tank_win_rate` and the like follow their own counts (_post)."""
    return key.lower() in _OWN_RATE


class Identities:
    """Real player identity → fake one, shared by every file of a run so links across files hold."""

    def __init__(self) -> None:
        self.tags: dict[str, str] = {}
        self.ints: dict[int, int] = {}

    def tag(self, real: str) -> str:
        if real not in self.tags:
            n = len(self.tags) + 1
            name, _, num = real.partition("#")
            if re.fullmatch(r"player\d+", name) and set(num) <= {"0"}:
                self.tags[real] = real  # already anonymous in HP's own feed
            else:
                self.tags[real] = f"Player{n}#{1000 + n}"
        return self.tags[real]

    def int_id(self, real: int) -> int:
        """Same digits, drawn from the real id's hash: stable whatever else the run redraws."""
        if real == 0:
            return 0
        if real not in self.ints:
            digits = len(str(abs(real)))
            lo, span = 10 ** (digits - 1), 9 * 10 ** (digits - 1)
            h = int(hashlib.sha256(f"id:{real}".encode()).hexdigest(), 16)
            fake = lo + h % span
            while fake in self.ints.values() or fake == real:
                fake = lo + (fake - lo + 1) % span
            self.ints[real] = fake
        return self.ints[real]

    def text(self, s: str) -> str:
        pairs = sorted(((r, f) for r, f in self.tags.items() if r != f), key=lambda kv: -len(kv[0]))
        for real, fake in pairs:
            s = s.replace(real, fake).replace(real.replace("#", "%23"), fake.replace("#", "%23"))
        for real, fake in pairs:
            name, fake_name = real.split("#")[0], fake.split("#")[0]
            if len(name) >= 5:  # a whole short name ("Zen") is too likely to be an ordinary word
                s = re.sub(rf"(?<![\w]){re.escape(name)}(?![\w])", fake_name, s)
        return s

    def scan(self, obj: Any) -> None:
        """Register every BattleTag in `obj`, so bare names are known before any rewrite."""
        if isinstance(obj, dict):
            for k, v in obj.items():
                self.scan(k)
                self.scan(v)
        elif isinstance(obj, list):
            for v in obj:
                self.scan(v)
        elif isinstance(obj, str):
            for m in _TAG.finditer(obj):
                self.tag(m.group(0))


def _redraw(x: int | float, rng: random.Random) -> int | float:
    if isinstance(x, bool) or x == 0:
        return x
    if isinstance(x, int):
        if abs(x) == 1:
            return x
        digits = len(str(abs(x)))
        v = rng.randrange(10 ** (digits - 1), 10**digits)
        return -v if x < 0 else v
    lo = 10 ** (len(str(int(abs(x)))) - 1) if abs(x) >= 1 else 0.0
    hi = 10 * lo if lo else 1.0
    v = rng.uniform(lo, hi)
    decimals = len(repr(x).split(".")[1]) if "." in repr(x) and "e" not in repr(x) else 2
    v = round(v, min(decimals, 4))
    return -v if x < 0 else v


def _decimals(x: float | int) -> int:
    r = repr(x)
    return len(r.split(".")[1]) if isinstance(x, float) and "." in r else 0


def _repair(d: dict[str, Any], src: dict[str, Any], rng: random.Random) -> None:
    """Make redrawn counts agree: wins/losses/games and the win rates computed from them."""
    games_key = next(
        (k for k in _GAMES if isinstance(d.get(k), int) and not isinstance(d.get(k), bool)), None
    )
    has_w = isinstance(d.get("wins"), int)
    has_l = isinstance(d.get("losses"), int)
    if games_key and has_w:
        g = d[games_key]
        d["wins"] = round(g * rng.uniform(0.40, 0.60))
        if has_l:
            d["losses"] = g - d["wins"]
    elif has_w and has_l:
        g = d["wins"] + d["losses"]
        d["wins"] = round(g * rng.uniform(0.40, 0.60))
        d["losses"] = g - d["wins"]
    total = (
        d[games_key]
        if games_key and has_w
        else (d["wins"] + d["losses"] if has_w and has_l else None)
    )
    rate = round(rng.uniform(40.0, 60.0), 2)
    for k, v in list(d.items()):
        if _rate_key(k) and isinstance(v, (int, float)) and not isinstance(v, bool):
            if total:
                exact = d["wins"] / total * 100
                d[k] = (
                    round(exact, _decimals(src[k]) or 0)
                    if isinstance(src[k], float)
                    else round(exact)
                )
            elif v <= 1 and isinstance(v, float):
                d[k] = round(rate / 100, max(_decimals(v), 3))
            else:
                d[k] = round(rate, _decimals(v)) if isinstance(v, float) else round(rate)


def synth(obj: Any, seed: str, ids: Identities | None = None) -> Any:
    """`obj` with HP's measurements redrawn and player identities replaced (deterministic)."""
    ids = ids or Identities()
    rng = random.Random(hashlib.sha256(seed.encode()).hexdigest())

    def walk(o: Any, key: str = "") -> Any:
        if isinstance(o, dict):
            out: dict[str, Any] = {}
            for k, v in o.items():
                nk = ids.text(k)
                if k in _IDENTITY_INT and isinstance(v, int) and not isinstance(v, bool):
                    out[nk] = ids.int_id(v)
                elif k.lower() == "fingerprint" and isinstance(v, str):
                    out[nk] = "".join(
                        rng.choice("0123456789abcdef") if c.isalnum() else c for c in v
                    )
                else:
                    out[nk] = walk(v, k)
            _repair(out, o, rng)
            if "per_page" in o:  # a page of a list: where it is, not a measurement
                out.update({k: o[k] for k in _PAGING if k in o})
            return _keep_dict_order(o, out)
        if isinstance(o, list):
            return _keep_order(o, [walk(v, key) for v in o])
        if isinstance(o, str):
            for m in _TAG.finditer(o):
                ids.tag(m.group(0))
            return ids.text(o)
        if isinstance(o, (int, float)) and not isinstance(o, bool):
            if _keep_key(key):
                return o
            v = _redraw(o, rng)
            return o if key in _KEEP_DRAWN else v
        return o

    out = walk(obj)
    # Fixes that need the whole object draw from their own generator, so adding one never moves
    # the numbers drawn above (tests pin those).
    _post(out, random.Random(hashlib.sha256(f"{seed}:post".encode()).hexdigest()))
    return out


_ORDER_KEYS = ("games", "games_played", "win_rate", "winrate")


def _keep_order(src: list[Any], out: list[Any]) -> list[Any]:
    """A list HP sent sorted (most played first, best first) stays sorted by the same key."""
    if len(src) < 2 or not all(isinstance(r, dict) for r in src):
        return out
    for k in _ORDER_KEYS:
        vals = [r.get(k) for r in src]
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in vals):
            continue
        if len(set(vals)) > 1 and vals == sorted(vals, reverse=True):
            return sorted(out, key=lambda r: r[k], reverse=True)
    return out


def _keep_dict_order(src: dict[str, Any], out: dict[str, Any]) -> dict[str, Any]:
    """A ranking sent as a dict ordered by value (hero → damage) is reordered by the new values:
    the old order would still tell the real ranking."""
    vals = list(src.values())
    if len(vals) < 3 or not all(
        isinstance(v, (int, float)) and not isinstance(v, bool) for v in vals
    ):
        return out
    if vals != sorted(vals, reverse=True) or len(set(vals)) == 1:
        return out
    return dict(sorted(out.items(), key=lambda kv: kv[1], reverse=True))


def _spread(total: int, weights: list[float], cap: list[int] | None = None) -> list[int]:
    """`total` split in proportion to `weights` (largest remainder), each within [0, cap]."""
    w = sum(weights) or 1.0
    exact = [total * x / w for x in weights]
    parts = [int(e) for e in exact]
    if cap:
        parts = [min(p, c) for p, c in zip(parts, cap, strict=True)]
    order = sorted(range(len(parts)), key=lambda i: exact[i] - int(exact[i]), reverse=True)
    i = 0
    while sum(parts) < total and i < 10 * len(parts) + total:
        j = order[i % len(order)]
        if not cap or parts[j] < cap[j]:
            parts[j] += 1
        i += 1
    return parts


def _games_key(row: dict[str, Any]) -> str:
    return "games" if isinstance(row.get("games"), int) else "games_played"


def _fix_pairs(own: dict[str, Any], pairs: list[Any], per_game: int, rng: random.Random) -> None:
    """Pairs of one side add up to the hero's own record: every game has `per_game` of them.

    HP's enemy rows carry the hero's wins and losses but a *loss* rate ("Lost against a team
    with X 59.62% of games"); the site's own files carry the win rate on both sides.
    """
    rows = [p for p in pairs if isinstance(p, dict) and isinstance(p.get(_games_key(p)), int)]
    rows = [p for p in rows if p[_games_key(p)] > 0]  # a hero not yet in the patch stays at 0
    if not rows or not own["games"]:
        return
    total = per_game * own["games"]
    games = [max(g, 1) for g in _spread(total, [max(p[_games_key(p)], 1) for p in rows])]
    while sum(games) > total:  # the floor of 1 may overshoot by a few
        games[games.index(max(games))] -= 1
    rate = own["wins"] / own["games"]
    weights = [g * min(max(rate + rng.uniform(-0.12, 0.12), 0.05), 0.95) for g in games]
    wins = _spread(per_game * own["wins"], weights, cap=games)
    for p, g, w in zip(rows, games, wins, strict=True):
        p[_games_key(p)], p["wins"] = g, w
        if "losses" in p:
            p["losses"] = g - w
        if isinstance(p.get("win_rate"), (int, float)) and g:
            lost = str(p.get("hovertext", "")).startswith("Lost")
            p["win_rate"] = round((g - w if lost else w) / g * 100, _decimals(p["win_rate"]) or 1)


def _fix_matchups(o: dict[str, Any], rng: random.Random) -> None:
    ally, enemy = o.get("ally"), o.get("enemy")
    if not (isinstance(ally, list) and isinstance(enemy, list)):
        return
    if isinstance(o.get("games"), int) and isinstance(o.get("wins"), int):
        own = {"games": o["games"], "wins": o["wins"]}
    else:  # HP's answer has no own record: it is what the ally rows add up to
        rows = [r for r in ally if isinstance(r, dict) and isinstance(r.get(_games_key(r)), int)]
        if not rows:
            return
        own = {
            "games": round(sum(r[_games_key(r)] for r in rows) / 4),
            "wins": round(sum(r["wins"] for r in rows) / 4),
        }
    _fix_pairs(own, ally, 4, rng)
    _fix_pairs(own, enemy, 5, rng)
    by_name = {
        (side, _name(r)): r for side in ("ally", "enemy") for r in o[side] if isinstance(r, dict)
    }
    for pair in o.get("combined") or []:
        for side in ("ally", "enemy"):
            r = pair.get(side) if isinstance(pair, dict) else None
            if isinstance(r, dict) and (side, _name(r)) in by_name:
                fixed = by_name[(side, _name(r))]
                r.update({k: v for k, v in fixed.items() if k != "hero"})


def _name(row: dict[str, Any]) -> str:
    h = row.get("hero")
    return str(h.get("name") if isinstance(h, dict) else h)


def _fix_rates(o: dict[str, Any], rng: random.Random) -> None:
    """`x_win_rate` from `x_wins`/`x_losses` when the record has them, else a plausible rate."""
    for k, v in list(o.items()):
        if not (k.endswith("win_rate") and k not in _OWN_RATE) or isinstance(v, bool):
            continue
        if not isinstance(v, (int, float)):
            continue
        prefix = k[: -len("win_rate")]
        w, lost = o.get(f"{prefix}wins"), o.get(f"{prefix}losses")
        if isinstance(w, int) and isinstance(lost, int) and w + lost:
            o[k] = round(w / (w + lost) * 100, _decimals(v) or 2)
        else:
            o[k] = round(rng.uniform(40.0, 60.0), _decimals(v) or 2)
    w, lost = o.get("win"), o.get("loss")
    if isinstance(w, int) and isinstance(lost, int) and "win_rate" in o and w + lost:
        o["win_rate"] = round(w / (w + lost) * 100, _decimals(o["win_rate"]) or 2)


def _fix_levels(rows: list[Any], rng: random.Random) -> None:
    """A replay's team level rises from 1, at most to 30."""
    if not rows or not all(isinstance(r, dict) and "TeamLevel" in r for r in rows):
        return
    team = next((k for k in ("team", "Team", "team_id") if k in rows[0]), None)
    groups: dict[Any, list[dict[str, Any]]] = {}
    for r in rows:
        groups.setdefault(r.get(team) if team else 0, []).append(r)
    for group in groups.values():
        top, n = rng.randint(16, 25), len(group)
        for i, r in enumerate(group):
            r["TeamLevel"] = 1 + (i * (top - 1)) // max(n - 1, 1)


_PROSE = {"hovertext", "total_time_played", "average_time_on_fire", "ko", "en"}
_NUMBER = re.compile(r"(?<![\d./:\-])\d[\d,]*(?:\.\d+)?(?![\d./:\-])")


def _scramble_number(m: re.Match[str], rng: random.Random) -> str:
    out, first = [], True
    for c in m.group(0):
        if c.isdigit():
            out.append(str(rng.randint(1, 9) if first else rng.randint(0, 9)))
            first = False
        else:
            out.append(c)
    return "".join(out)


def _fix_prose(o: dict[str, Any], rng: random.Random) -> None:
    """Numbers inside sentences ("50.87% win rate over 401 games") are measurements too."""
    for k in _PROSE:
        v = o.get(k)
        if isinstance(v, str):
            o[k] = _NUMBER.sub(lambda m: _scramble_number(m, rng), v)
        elif isinstance(v, list):
            o[k] = [
                _NUMBER.sub(lambda m: _scramble_number(m, rng), x) if isinstance(x, str) else x
                for x in v
            ]
    text = o.get("hovertext")
    if isinstance(text, str) and isinstance(o.get("win_rate"), (int, float)):
        text = re.sub(r"[\d.]+%", f"{o['win_rate']}%", text, count=1)
        games = o.get(_games_key(o))
        if isinstance(games, int):
            text = re.sub(r"over [\d,]+ games", f"over {games} games", text)
        o["hovertext"] = text


def _post(o: Any, rng: random.Random) -> None:
    if isinstance(o, list):
        for v in o:
            _post(v, rng)
        _fix_levels(o, rng)
        return
    if not isinstance(o, dict):
        return
    for v in o.values():
        _post(v, rng)
    if all(isinstance(o.get(k), int) for k in ("kills", "assists", "takedowns")):
        o["takedowns"] = o["kills"] + o["assists"]
    _fix_rates(o, rng)
    _fix_matchups(o, rng)
    _fix_prose(o, rng)
    for side in ("ally", "enemy"):  # their rates changed above: say the new ones
        rows = o.get(side)
        for r in rows if isinstance(rows, list) else []:
            if isinstance(r, dict):
                _fix_prose(r, rng)


# Situations the end-to-end tests need, set by hand after the redraw (they were hand-made in the
# recorded fixtures too): path suffix → change.
def _butcher_party_corrected(o: dict[str, Any]) -> None:
    """Only The Butcher is party-corrected in Quick Match, down to 44 %: it sinks to F. Solo queue
    wins below 50 % (parties win more often), so the printed correction adds to the win rate."""
    if isinstance(o.get("party"), dict):
        o["party"]["solo_pooled"] = 48.4
    for r in o["rows"]:
        if r["hero"] == "The Butcher" and r["map"] == "all":
            r["tier_win_rate"] = 44.0


def _thin_master_league(o: dict[str, Any]) -> None:
    """Abathur's master+ point is under 30 games: drawn faint."""
    cell = o["heroes"]["Abathur"][-1]
    cell["games"], cell["wins"] = 24, 11
    for k in ("win_rate", "tier_win_rate"):
        if k in cell:
            cell[k] = round(11 / 24 * 100, 1)


def _no_healer_loses(o: dict[str, Any]) -> None:
    """A team without a healer loses beyond the error (the draft's team term)."""
    g = o["groups"]["healer"]["0"]
    g["wins"] = round(g["games"] * 0.36)


def _thin_na_quick_match(o: dict[str, Any]) -> None:
    """Quick Match NA has under half the site's heroes at the tier floor: a thin region."""
    heroes = sorted({r["hero"] for r in o["rows"]})
    thin = {h for i, h in enumerate(heroes) if i % 3}
    for r in o["rows"]:
        if r["hero"] in thin:
            r["games"] = 10 + r["games"] % 39
            r["wins"] = round(r["games"] * r["win_rate"] / 100)
            if "losses" in r:
                r["losses"] = r["games"] - r["wins"]
            for k in ("win_rate", "tier_win_rate"):
                if k in r:
                    r[k] = round(r["wins"] / r["games"] * 100, _decimals(r[k]) or 1)


_SCENARIOS = {
    "e2e-data/latest/qm_na.json": _thin_na_quick_match,
    "e2e-data/latest/qm.json": _butcher_party_corrected,
    "e2e-data/previous/qm.json": _butcher_party_corrected,  # the same patch file, so ranks agree
    "e2e-data/latest/sl_tiers.json": _thin_master_league,
    "e2e-data/latest/sl_comps.json": _no_healer_loses,
}


def scenario(path: str, obj: Any) -> Any:
    for suffix, change in _SCENARIOS.items():
        if path.endswith(suffix):
            change(obj)
    return obj


def recount_meta(meta: dict[str, Any], snapshots: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """meta.json's per-mode counts, recounted from the redrawn files by the collector's rule."""
    from collector.snapshot import MIN_GAMES_FOR_TIER, PATCH_HEALTH_GAMES

    for mode, summary in meta.get("modes", {}).items():
        snap = snapshots.get(mode)
        if snap is None:
            continue
        rows = [r for r in snap["rows"] if r["map"] == "all"]
        summary.update(
            matches=snap["matches"],
            heroes=len(rows),
            heroes_ranked=sum(1 for r in rows if r["games"] >= MIN_GAMES_FOR_TIER),
            heroes_over_200=sum(1 for r in rows if r["games"] >= PATCH_HEALTH_GAMES),
        )
    return meta


def _read(path: Path) -> Any:
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return json.load(f)
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path: Path, obj: Any, like: str) -> None:
    indent = 1 if "\n " in like[:200] else (2 if "\n  " in like[:200] else None)
    text = json.dumps(obj, ensure_ascii=False, indent=indent) + (
        "\n" if like.endswith("\n") else ""
    )
    if path.suffix == ".gz":
        with path.open("wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as f:
            f.write(text.encode("utf-8"))
    else:
        path.write_text(text, encoding="utf-8")


def main(paths: list[str]) -> int:
    ids = Identities()
    for p in map(Path, paths):
        ids.scan(_read(p))
    for p in map(Path, paths):
        raw = (
            gzip.decompress(p.read_bytes()).decode() if p.suffix == ".gz" else p.read_text("utf-8")
        )
        _write(p, scenario(p.as_posix(), synth(_read(p), seed=p.name, ids=ids)), raw)
    for meta in {p for p in map(Path, paths) if p.name == "meta.json"}:
        modes = {f.stem: _read(f) for f in meta.parent.glob("*.json") if f.name != "meta.json"}
        _write(meta, recount_meta(_read(meta), modes), meta.read_text("utf-8"))
    print(json.dumps({"files": len(paths), "battletags": len(ids.tags), "ids": len(ids.ints)}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
