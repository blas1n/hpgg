"""End-of-match awards (MVP, 고통인도자 …): names, icons, and Heroes Profile's award ids.

  uv run python tools/build_awards.py --build 2.55.16.97039

Writes data/awards.json (game award key → Korean and English name, icon file),
data/img/awards/*.png (each award's icon at 64 px, MVP in gold, the rest blue — as the game's
MVP screen draws a player's own team), server/players/game_awards.json (every award's English
name and icon stem, which the server resolves new HP ids against) and
server/players/hp_awards.json (HP `award_id` → key, the ids seen so far).
Names come from HeroesToolChest heroes-data (MIT) gamestrings kokr/enus `award/name`, icons from
heroes-images `matchawards`.

HP lists awards by its own id (in /players/matches only the id). tools/hp_awards_seen.json records
the id, title and icon HP returned in /replay/{id} answers; an id maps to the game award whose
English name is HP's title, else whose icon HP sent (server/players/awards.py `resolve_with`).
The server learns ids missing here by itself (table hp_award_map); rerun this tool for a newer
heroes-data build, i.e. when the server logs `awards.unresolved` (an award the game data lacks).
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path
from typing import Any
from urllib.request import urlopen

import structlog

from server.players.awards import resolve_with

RAW_DATA = "https://raw.githubusercontent.com/HeroesToolChest/heroes-data/master/heroesdata"
RAW_IMG = "https://raw.githubusercontent.com/HeroesToolChest/heroes-images/master/heroesimages"
ROOT = Path(__file__).resolve().parents[1]
log = structlog.get_logger(__name__)


def _icon_stem(mvp_screen_icon: str) -> str:
    """'storm_ui_mvp_bulwark_%color%.png' → 'storm_ui_mvp_bulwark'."""
    return re.sub(r"_%color%\.png$", "", mvp_screen_icon)


def award_table(
    awd: dict[str, Any], kokr: dict[str, Any], enus: dict[str, Any]
) -> dict[str, dict[str, str]]:
    ko = kokr["gamestrings"]["award"]["name"]
    en = enus["gamestrings"]["award"]["name"]
    out = {}
    for key, a in sorted(awd.items()):
        if key not in ko or "mvpScreenIcon" not in a:
            continue
        color = "gold" if key == "MVP" else "blue"
        out[key] = {
            "ko": ko[key],
            "en": en.get(key, key),
            "icon": f"{_icon_stem(a['mvpScreenIcon'])}_{color}.png",
        }
    return out


def game_awards(awd: dict[str, Any], enus: dict[str, Any]) -> dict[str, dict[str, str]]:
    """Every award's English name and icon stem: what HP's titles and icons are matched against."""
    en = enus["gamestrings"]["award"]["name"]
    return {
        key: {"en": en.get(key, key), "icon": _icon_stem(a["mvpScreenIcon"])}
        for key, a in sorted(awd.items())
        if "mvpScreenIcon" in a
    }


def hp_award_keys(
    seen: dict[int, tuple[str, str]], awd: dict[str, Any], enus: dict[str, Any]
) -> dict[str, str]:
    game = game_awards(awd, enus)
    out = {}
    for hp_id, (title, icon) in sorted(seen.items()):
        key = resolve_with(title, icon, game)
        if key is None:
            log.warning("awards.unmapped", hp_id=hp_id, title=title)
            continue
        out[str(hp_id)] = key
    return out


def _get(url: str) -> bytes:
    with urlopen(url, timeout=60) as r:  # noqa: S310 - fixed GitHub raw host
        data: bytes = r.read()
    return data


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--build", required=True)
    args = p.parse_args()
    b = args.build.split(".")[-1]
    base = f"{RAW_DATA}/{args.build}"
    awd = json.loads(_get(f"{base}/data/matchawarddata_{b}_localized.json"))
    kokr = json.loads(_get(f"{base}/gamestrings/gamestrings_{b}_kokr.json"))
    enus = json.loads(_get(f"{base}/gamestrings/gamestrings_{b}_enus.json"))
    table = award_table(awd, kokr, enus)
    source = f"HeroesToolChest heroes-data {args.build} (matchawarddata, gamestrings award/name)"
    (ROOT / "data/awards.json").write_text(
        json.dumps({"source": source, "awards": table}, ensure_ascii=False, indent=1) + "\n",
        "utf-8",
    )
    img = ROOT / "data/img/awards"
    img.mkdir(parents=True, exist_ok=True)
    for a in table.values():
        dest = img / a["icon"]
        if not dest.exists():
            dest.write_bytes(_get(f"{RAW_IMG}/matchawards/{a['icon']}"))
            # 168 px in the game files; drawn at 28 px at most, so 64 covers 2x screens
            subprocess.run(["sips", "-Z", "64", str(dest)], capture_output=True, check=False)
    seen_raw = json.loads((ROOT / "tools/hp_awards_seen.json").read_text("utf-8"))
    seen = {int(k): (v[0], v[1]) for k, v in seen_raw.items()}
    keys = hp_award_keys(seen, awd, enus)
    (ROOT / "server/players/hp_awards.json").write_text(json.dumps(keys, indent=1) + "\n", "utf-8")
    game = json.dumps(game_awards(awd, enus), indent=1) + "\n"
    (ROOT / "server/players/game_awards.json").write_text(game, "utf-8")
    log.info("awards.built", awards=len(table), hp_ids=len(keys))


if __name__ == "__main__":
    main()
