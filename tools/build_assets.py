"""Regenerate localisation tables and images from HeroesToolChest (MIT) game data.

  uv run python tools/build_assets.py --build 2.55.16.97039 [--icons <builds fixture>]

Writes: data/heroes_ko.json (every hero already listed or in data/latest/, when the game data has
it), data/img/heroes/<slug>.png (missing portraits), data/talents/<hero slug>.json (talent_name →
Korean name, icon, description, cooldown), data/img/talents/*.png. A hero the build does not have
yet (a new release) is logged and left out; the site shows only heroes in heroes_ko.json, so rerun
with a newer --build to add it. Sources recorded per file. --skip-icons: tables only, no images.
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

import structlog

RAW_DATA = "https://raw.githubusercontent.com/HeroesToolChest/heroes-data/master/heroesdata"
RAW_IMG = "https://raw.githubusercontent.com/HeroesToolChest/heroes-images/master/heroesimages"
log = structlog.get_logger(__name__)

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


def stats_hero_names(data_dir: Path) -> set[str]:
    """Every hero the collector saw: stats rows of data/latest/*.json plus the builds' hero keys."""
    names: set[str] = set()
    for p in (data_dir / "latest").glob("*.json"):
        d = json.loads(p.read_text(encoding="utf-8"))
        names |= {r["hero"] for r in d.get("rows", [])}
        names |= set(d.get("heroes", {}))
    return names


def hero_rows(
    herodata: dict[str, Any],
    kokr: dict[str, Any],
    names: set[str],
    roles: list[dict[str, str]],
) -> tuple[list[dict[str, str]], list[str]]:
    """heroes_ko.json rows (by English name) for the heroes the game data has, and the names it
    does not have yet — a hero released after that heroes-data build. The site shows only heroes
    with a row (web/src/lib/known.ts); rerunning with a newer build adds them."""
    unit = kokr["gamestrings"]["unit"]
    role_by_ko = {r["ko"]: r["name"] for r in roles}
    idx = hero_index(herodata)
    rows: list[dict[str, str]] = []
    missing: list[str] = []
    for n in sorted(names):
        found = idx.get(norm(n))
        if not found:
            missing.append(n)
            continue
        hid = found[0]
        role_ko = unit["expandedrole"][hid]
        rows.append(
            {
                "name": n,
                "slug": slug(n),
                "ko": unit["name"][hid],
                "role": role_by_ko[role_ko],
                "role_ko": role_ko,
                "short_name": norm(n),
                "portrait": f"img/heroes/{slug(n)}.png",
            }
        )
    return rows, missing


def portrait_file(hero: dict[str, Any]) -> str | None:
    """heroes-images heroportraits/ file name: the draft-screen portrait."""
    p = (hero.get("portraits") or {}).get("draftScreen")
    return str(p) if p else None


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


# Korean reading of a trailing digit, for particle choice: 1 일, 3 삼, 6 육, 7 칠, 8 팔 have a final
# consonant; 0 at the end of a multi-digit number is 십/백/천/만 (final consonant, not ㄹ).
_DIGIT_JONG = {"0": "x", "1": "ㄹ", "3": "x", "6": "x", "7": "ㄹ", "8": "ㄹ"}


def _final_consonant(text: str) -> str | None:
    """None (no final consonant), "ㄹ", or "x" (any other) for the last readable character."""
    t = text.rstrip()
    if not t:
        return None
    ch = t[-1]
    if "가" <= ch <= "힣":
        jong = (ord(ch) - 0xAC00) % 28
        return None if jong == 0 else ("ㄹ" if jong == 8 else "x")
    if ch.isdigit():
        if ch == "0" and not (len(t) > 1 and t[-2].isdigit()):
            return "x"  # 영
        return _DIGIT_JONG.get(ch)
    return None  # %, latin, punctuation: read without a final consonant (퍼센트, …)


def _pick_particle(before: str, options: str) -> str:
    """`<lang rule="jongsung">으로,로</lang>`: first option after a final consonant, else the
    second; 으로 → 로 after ㄹ."""
    with_jong, without = (options.split(",") + [""])[:2]
    j = _final_consonant(before)
    if j is None or (j == "ㄹ" and with_jong.startswith("으")):
        return without
    return with_jong


def _scaling(m: re.Match[str]) -> str:
    pct = float(m.group(1)) * 100
    return f"(레벨당 +{pct:g}%)"


def clean_desc(raw: str) -> str:
    """Game tooltip markup → plain text; highlighted values become {{…}} for the page to style.
    `108~~0.04~~` means +4 % per hero level."""
    s = re.sub(r"~~([0-9.]+)~~", _scaling, raw)
    s = re.sub(r"<n\s*/>|</n>", "\n", s)
    s = re.sub(r"<img[^>]*/?>", "", s)
    s = re.sub(r'<c val="[^"]*">(.*?)</c>', r"{{\1}}", s)
    s = re.sub(r"<s [^>]*>(.*?)</s>", r"\1", s)
    out = ""
    for part in re.split(r'(<lang rule="jongsung">[^<]*</lang>)', s):
        m = re.fullmatch(r'<lang rule="jongsung">([^<]*)</lang>', part)
        out += _pick_particle(out.replace("{{", "").replace("}}", ""), m.group(1)) if m else part
    out = re.sub(r"<[^>]+>", "", out)  # anything left unknown
    return out.replace("{{}}", "").strip()


def hero_talent_files(
    herodata: dict[str, Any], kokr: dict[str, Any], heroes: list[dict[str, Any]]
) -> dict[str, dict[str, dict[str, str]]]:
    """Per hero slug: talent nameId → {ko, icon, desc?, cd?}. One small file per hero so the hero
    page loads only its own talents (descriptions for every hero are ~0.8 MB)."""
    names = talent_table(herodata, kokr)
    strings = kokr["gamestrings"]["abiltalent"]

    def first(field: str) -> dict[str, str]:
        out: dict[str, str] = {}
        for key, val in strings.get(field, {}).items():
            out.setdefault(key.split("|")[0], val)
        return out

    full, cooldown = first("full"), first("cooldown")
    idx = hero_index(herodata)
    files: dict[str, dict[str, dict[str, str]]] = {}
    for h in heroes:
        found = idx.get(norm(h["name"]))
        if not found:
            continue
        table: dict[str, dict[str, str]] = {}
        for tier_talents in (found[1].get("talents") or {}).values():
            for t in tier_talents:
                name_id = t.get("nameId")
                if not name_id:
                    continue
                entry = dict(names[name_id])
                if name_id in full:
                    entry["desc"] = clean_desc(full[name_id])
                if name_id in cooldown:
                    entry["cd"] = clean_desc(cooldown[name_id])
                table[name_id] = entry
        files[h["slug"]] = table
    return files


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
    ap.add_argument("--skip-icons", action="store_true", help="tables only, no image downloads")
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
    for icon in [] if args.skip_icons else sorted(want):
        dst = tdir / icon
        if dst.exists():
            continue
        tmp = cache / "icons" / icon
        if not tmp.exists() and not fetch(f"{RAW_IMG}/abilitytalents/{icon}", tmp):
            missing += 1
            continue
        resize(tmp, dst, 40)
    # heroes: every hero already listed or seen by the collector, if the game data has it
    table_p = data / "heroes_ko.json"
    table = json.loads(table_p.read_text(encoding="utf-8"))
    names = {h["name"] for h in table["heroes"]} | stats_hero_names(data)
    heroes, missing_heroes = hero_rows(herodata, kokr, names, table["roles"])
    if missing_heroes:
        log.warning(
            "assets.heroes_without_game_data",
            heroes=missing_heroes,
            build=args.build,
            note="not shown on the site until a heroes-data build has them",
        )
    table["heroes"] = heroes
    table["source"]["names"] = f"HeroesToolChest/heroes-data gamestrings kokr (build {b}, MIT)"
    table_p.write_text(json.dumps(table, ensure_ascii=False, indent=0), encoding="utf-8")
    idx = hero_index(herodata)
    for h in [] if args.skip_icons else heroes:
        dst = data / h["portrait"]
        src = portrait_file(idx[norm(h["name"])][1])
        if dst.exists() or not src:
            continue
        tmp = cache / "portraits" / src
        if not tmp.exists() and not fetch(f"{RAW_IMG}/heroportraits/{src}", tmp):
            log.warning("assets.portrait_missing", hero=h["name"], file=src)
            continue
        resize(tmp, dst, 96)
    source = f"HeroesToolChest heroes-data {args.build} (gamestrings kokr) + heroes-images, MIT"
    out_dir = data / "talents"
    out_dir.mkdir(parents=True, exist_ok=True)
    for hero_slug, table in hero_talent_files(herodata, kokr, heroes).items():
        (out_dir / f"{hero_slug}.json").write_text(
            json.dumps(
                {"source": source, "talents": table}, ensure_ascii=False, separators=(",", ":")
            ),
            encoding="utf-8",
        )
    log.info(
        "assets.done",
        heroes=len(heroes),
        talents=len(talents),
        icons_wanted=len(want),
        icons_missing=missing,
    )


if __name__ == "__main__":
    main()
