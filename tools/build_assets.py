"""Regenerate localisation tables and images from HeroesToolChest (MIT) game data.

  uv run python tools/build_assets.py --build 2.55.16.97039 [--icons <builds fixture>]

Writes: data/heroes_ko.json (names, roles, slugs, portraits), data/talents_ko.json (talent_name →
Korean name + icon), data/img/heroes/*.png, data/img/talents/*.png. Sources recorded per file.
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import subprocess
import unicodedata
from pathlib import Path
from typing import Any
from urllib.request import urlopen

RAW_DATA = "https://raw.githubusercontent.com/HeroesToolChest/heroes-data/master/heroesdata"
RAW_IMG = "https://raw.githubusercontent.com/HeroesToolChest/heroes-images/master/heroesimages"
MANUAL_HERO_KEYS = {"cho": "Cho", "thelostvikings": "LostVikings"}


def norm(s: str) -> str:
    """Key that ignores case, punctuation and diacritics: Anub'arak → anubarak, Lúcio → lucio."""
    return re.sub(
        r"[^a-z0-9]",
        "",
        unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower(),
    )


def slug(s: str) -> str:
    t = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


def hero_index(herodata: dict[str, Any]) -> dict[str, tuple[str, dict[str, Any]]]:
    """norm(hyperlinkId) → (heroId, hero), plus the two ids whose hyperlink differs from HP."""
    idx = {norm(h.get("hyperlinkId") or hid): (hid, h) for hid, h in herodata.items()}
    for key, hid in MANUAL_HERO_KEYS.items():
        if hid in herodata:
            idx[key] = (hid, herodata[hid])
    return idx


def korean_hero_names(
    herodata: dict[str, Any], kokr: dict[str, Any], hp_names: list[str]
) -> dict[str, str]:
    names = kokr["gamestrings"]["unit"]["name"]
    idx = hero_index(herodata)
    out: dict[str, str] = {}
    for n in hp_names:
        hid, _ = idx[norm(n)]
        out[n] = names[hid]
    return out


def talent_table(herodata: dict[str, Any], kokr: dict[str, Any]) -> dict[str, dict[str, str]]:
    """talent nameId (= HP `talent_name`) → {ko, icon}. Korean names come from
    gamestrings abiltalent/name keyed `<nameId>|<buttonId>|<hotkey>|<isPassive>`."""
    ko_by_name_id: dict[str, str] = {}
    for key, val in kokr["gamestrings"]["abiltalent"]["name"].items():
        ko_by_name_id.setdefault(key.split("|")[0], val)
    out: dict[str, dict[str, str]] = {}
    for h in herodata.values():
        for tier_talents in (h.get("talents") or {}).values():
            for t in tier_talents:
                name_id = t.get("nameId")
                if not name_id:
                    continue
                out[name_id] = {
                    "ko": ko_by_name_id.get(name_id, t.get("name", name_id)),
                    "icon": t.get("icon", ""),
                }
    return out


def fetch(url: str, dest: Path) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        with urlopen(url, timeout=60) as r:  # noqa: S310 - fixed GitHub raw host
            dest.write_bytes(r.read())
        return True
    except Exception:  # noqa: BLE001
        return False


def resize(src: Path, dst: Path, px: int) -> None:
    subprocess.run(
        ["sips", "-Z", str(px), str(src), "--out", str(dst)], capture_output=True, check=False
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", required=True, help="heroes-data build folder, e.g. 2.55.16.97039")
    ap.add_argument("--data", default="data")
    ap.add_argument(
        "--icons", help="builds_all fixture (.json or .json.gz): only download icons used there"
    )
    ap.add_argument("--cache", default=".cache/htc")
    args = ap.parse_args()
    data = Path(args.data)
    cache = Path(args.cache)
    b = args.build.split(".")[-1]
    herodata_p = cache / f"herodata_{b}.json"
    kokr_p = cache / f"kokr_{b}.json"
    for p, url in (
        (herodata_p, f"{RAW_DATA}/{args.build}/data/herodata_{b}_localized.json"),
        (kokr_p, f"{RAW_DATA}/{args.build}/gamestrings/gamestrings_{b}_kokr.json"),
    ):
        if not p.exists() and not fetch(url, p):
            raise SystemExit(f"download failed: {url}")
    herodata = json.loads(herodata_p.read_text(encoding="utf-8"))
    kokr = json.loads(kokr_p.read_text(encoding="utf-8"))

    # talents
    talents = talent_table(herodata, kokr)
    want: set[str] = set()
    if args.icons:
        opener = gzip.open if args.icons.endswith(".gz") else open
        with opener(args.icons, "rt", encoding="utf-8") as f:  # type: ignore[operator]
            builds = json.load(f)
        for v in builds.values():
            if isinstance(v, list):
                for bd in v:
                    for k, t in bd.items():
                        if k.startswith("level_") and isinstance(t, dict) and t.get("icon"):
                            want.add(t["icon"])
    else:
        want = {t["icon"] for t in talents.values() if t["icon"]}
    tdir = data / "img" / "talents"
    missing = 0
    for icon in sorted(want):
        dst = tdir / icon
        if dst.exists():
            continue
        tmp = cache / "icons" / icon
        if not tmp.exists() and not fetch(f"{RAW_IMG}/abilitytalents/{icon}", tmp):
            missing += 1
            continue
        resize(tmp, dst, 40)
    (data / "talents_ko.json").write_text(
        json.dumps(
            {
                "source": (
                    f"HeroesToolChest heroes-data {args.build} (gamestrings kokr)"
                    " + heroes-images abilitytalents, MIT"
                ),
                "talents": talents,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    print(f"talents: {len(talents)} names, icons wanted {len(want)}, missing {missing}, dir {tdir}")


if __name__ == "__main__":
    main()
