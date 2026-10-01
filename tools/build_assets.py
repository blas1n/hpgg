"""Regenerate localisation tables and images from HeroesToolChest (MIT) game data.

  uv run python tools/build_assets.py --build 2.57.0.98304

Game data: a heroes-data2 release (HeroesDataParser v5, read through `from_v5`).

Writes: data/heroes_ko.json (every hero already listed or in data/latest/, when the game data has
it; Korean and English names), data/img/heroes/<slug>.png (missing portraits),
data/talents/<hero slug>.json (talent_name → Korean and English name, icon, description, cooldown),
data/img/talents/*.png (every talent's icon). Korean strings come from gamestrings kokr, English
from gamestrings enus (the English fields sit next to the Korean ones, which stay byte for byte
what kokr alone gives).
A hero the build does not have yet (a new release) is logged and left out; the site shows only
heroes in heroes_ko.json, so rerun with a newer --build to add it. Sources recorded per file.
--skip-icons: tables only, no images.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import tarfile
import unicodedata
from pathlib import Path
from typing import Any
from urllib.request import urlopen

import structlog

# heroes-data stopped at 2.55.16.97039 (archived 2026-07); heroes-data2 has the newer builds,
# as full JSON only in each release's tarball (the repo tree holds patches)
RELEASE = (
    "https://github.com/HeroesToolChest/heroes-data2/releases/download/"
    "v{build}/heroes-data-no-maps-{build}.tar.gz"
)
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


def role_names(kokr: dict[str, Any], enus: dict[str, Any]) -> dict[str, str]:
    """Korean role name → English role name, paired through the heroes that carry them."""
    ko = kokr["gamestrings"]["unit"]["expandedrole"]
    en = enus["gamestrings"]["unit"]["expandedrole"]
    return {ko[hid]: en[hid] for hid in ko if hid in en}


# heroesofthestorm.com/ko-kr/heroes/ (archived 2023-04-02): The Lost Vikings is "Retro" (Nexus)
UNIVERSE_OF = {"Classic": "Nexus"}


def hero_rows(
    herodata: dict[str, Any],
    kokr: dict[str, Any],
    names: set[str],
    roles: list[dict[str, str]],
    enus: dict[str, Any] | None = None,
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
        row = {"name": n, "slug": slug(n), "ko": unit["name"][hid]}
        if enus is not None:
            row["en"] = enus["gamestrings"]["unit"]["name"].get(hid, n)
        row |= {
            "role": role_by_ko[role_ko],
            "role_ko": role_ko,
            "short_name": norm(n),
            "portrait": f"img/heroes/{slug(n)}.png",
        }
        # the hero's universe (#43): heroes-data `franchise`, grouped like Blizzard's heroes page,
        # which has five (Warcraft, StarCraft, Diablo, Overwatch, Nexus) — its "Nexus" (key `retro`)
        # holds heroes-data's Nexus and Classic (The Lost Vikings)
        franchise = found[1].get("franchise")
        if franchise:
            row["franchise"] = UNIVERSE_OF.get(franchise, franchise)
        rows.append(row)
    return rows, missing


def portrait_file(hero: dict[str, Any]) -> str | None:
    """heroes-images heroportraits/ file name: the draft-screen portrait."""
    p = (hero.get("portraits") or {}).get("draftScreen")
    return str(p) if p else None


def _by_name_id(strings: dict[str, Any], field: str) -> dict[str, str]:
    """gamestrings abiltalent/<field>, keyed `<nameId>|<buttonId>|<hotkey>|<isPassive>`, by
    nameId (the first entry wins)."""
    out: dict[str, str] = {}
    for key, val in strings["gamestrings"]["abiltalent"].get(field, {}).items():
        out.setdefault(key.split("|")[0], val)
    return out


def talent_table(herodata: dict[str, Any], kokr: dict[str, Any]) -> dict[str, dict[str, str]]:
    """talent nameId (= HP `talent_name`) → {ko, icon}. Korean names come from
    gamestrings abiltalent/name keyed `<nameId>|<buttonId>|<hotkey>|<isPassive>`."""
    ko_by_name_id = _by_name_id(kokr, "name")
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


_SCALING = {"ko": "(레벨당 +{pct}%)", "en": " (+{pct}% per level)"}


def clean_desc(raw: str, lang: str = "ko") -> str:
    """Game tooltip markup → plain text; highlighted values become {{…}} for the page to style.
    `108~~0.04~~` means +4 % per hero level (printed in `lang`: ko or en)."""
    s = re.sub(
        r"~~([0-9.]+)~~",
        lambda m: _SCALING[lang].format(pct=f"{float(m.group(1)) * 100:g}"),
        raw,
    )
    s = re.sub(r"<n\s*/>|</n>", "\n", s)
    s = re.sub(r"<img[^>]*/?>", "", s)
    s = re.sub(r'<c val="[^"]*"[^>]*>(.*?)</c>', r"{{\1}}", s)
    # heroes-data2 prints the per-level scaling as its own highlight: one value, as before
    s = re.sub(r"\}\}\{\{(\s?\()", r"\1", s)
    s = re.sub(r"<s [^>]*>(.*?)</s>", r"\1", s)
    out = ""
    for part in re.split(r'(<lang rule="jongsung">[^<]*</lang>)', s):
        m = re.fullmatch(r'<lang rule="jongsung">([^<]*)</lang>', part)
        out += _pick_particle(out.replace("{{", "").replace("}}", ""), m.group(1)) if m else part
    out = re.sub(r"<[^>]+>", "", out)  # anything left unknown
    return out.replace("{{}}", "").strip()


def _ability_names(strings: dict[str, Any]) -> dict[str, str]:
    """Ability id → name, abilities before talents (heroes-data2); heroes-data had one list."""
    g = strings["gamestrings"]
    return (
        _by_name_id({"gamestrings": {"abiltalent": g["ability"]}}, "name")
        if "ability" in g
        else (_by_name_id(strings, "name"))
    )


# abilities the hotfix diff can name (#62); mount, hearth, spray, voice, item actives are not
_ABILITY_TIERS = {"basic", "heroic", "trait"}
# Blizzard's patch notes write the heroic as [R] and the trait as [D]
_HOTKEY = {"Heroic": "R", "Trait": "D"}


def hero_game_ids(
    herodata: dict[str, Any],
    kokr: dict[str, Any],
    heroes: list[dict[str, Any]],
    enus: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    """Per hero slug: the game ids the hotfix diff names a changed number by (#62) — the hero
    unit, its weapons, the life/energy words of the game strings, and each ability by the
    common id prefix of its buttons ("MalGanisFelClaws" for First/Second/Third)."""
    ko_name, en_name = _ability_names(kokr), _ability_names(enus)
    ko_unit = kokr["gamestrings"].get("unit", {})
    en_unit = enus["gamestrings"].get("unit", {})
    idx = hero_index(herodata)
    out: dict[str, dict[str, Any]] = {}
    for h in heroes:
        found = idx.get(norm(h["name"]))
        if not found:
            continue
        key, hd = found
        buttons: list[dict[str, Any]] = []
        tiers = [hd.get("abilities") or {}]
        for sub in hd.get("subAbilities") or []:
            tiers.extend(sub.values())
        for t in tiers:
            for tier, abilities in t.items():
                if tier in _ABILITY_TIERS:
                    buttons.extend(a for a in abilities if "Cancel" not in a.get("buttonId", ""))
        by_name: dict[str, list[dict[str, Any]]] = {}
        for a in buttons:
            name = ko_name.get(a["nameId"])
            if name:
                by_name.setdefault(name, []).append(a)
        abilities: dict[str, dict[str, str]] = {}
        for name, group in by_name.items():
            # only the hero's own ids ("Stoneform" is a talent's, shared by name)
            group = [a for a in group if a["nameId"].startswith(key)]
            if not group:
                continue
            ids = [a["nameId"] for a in group]
            prefix = os.path.commonprefix(ids)
            # the buttons of one ability share an id prefix longer than the hero's own
            keys = [prefix] if len(prefix) > len(key) else ids
            first = group[0]
            for k in keys:
                abilities[k] = {
                    "ko": name,
                    "en": next((en_name[i] for i in ids if i in en_name), name),
                    "key": _HOTKEY.get(first["abilityType"], first["abilityType"]),
                }

        def words(field: str, key: str = key) -> dict[str, str] | None:
            ko = ko_unit.get(field, {}).get(key)
            return {"ko": ko, "en": en_unit.get(field, {}).get(key, ko)} if ko else None

        out[h["slug"]] = {
            "unit": hd.get("unitId", f"Hero{key}"),
            "weapons": [w["nameId"] for w in hd.get("weapons") or [] if w.get("nameId")],
            "life": words("lifetype"),
            "energy": words("energytype"),
            "abilities": abilities,
        }
    return out


def hero_talent_files(
    herodata: dict[str, Any],
    kokr: dict[str, Any],
    heroes: list[dict[str, Any]],
    enus: dict[str, Any] | None = None,
) -> dict[str, dict[str, dict[str, str]]]:
    """Per hero slug: talent nameId → {ko, icon, desc?, cd?, en?, desc_en?, cd_en?}. One small
    file per hero so the hero page loads only its own talents (every hero is ~0.8 MB)."""
    names = talent_table(herodata, kokr)
    full, cooldown = _by_name_id(kokr, "full"), _by_name_id(kokr, "cooldown")
    en_name, en_full, en_cd = (
        (_by_name_id(enus, "name"), _by_name_id(enus, "full"), _by_name_id(enus, "cooldown"))
        if enus is not None
        else ({}, {}, {})
    )
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
                if enus is not None:
                    entry["en"] = en_name.get(name_id) or t.get("name", name_id)
                    if name_id in en_full:
                        entry["desc_en"] = clean_desc(en_full[name_id], "en")
                    if name_id in en_cd:
                        entry["cd_en"] = clean_desc(en_cd[name_id], "en")
                table[name_id] = entry
        files[h["slug"]] = table
    return files


_PASSIVE = ":PASSIVE:"


def _v4_id(x: dict[str, Any], id_key: str) -> str | None:
    """v5 names a passive ability `:PASSIVE:` and keeps its own id in buttonId."""
    i = x.get(id_key)
    return x.get("buttonId") if i == _PASSIVE else i


def _v4_tiers(tiers: dict[str, Any], id_key: str) -> dict[str, list[dict[str, Any]]]:
    return {
        tier.lower(): [{**x, "nameId": _v4_id(x, id_key)} for x in items if _v4_id(x, id_key)]
        for tier, items in tiers.items()
    }


def _v4_key(link_id: str) -> str:
    """`:PASSIVE:|AlarakSadism|Trait` → `AlarakSadism|Trait`: the id first, as heroes-data."""
    return link_id.split("|", 1)[1] if link_id.startswith(_PASSIVE + "|") else link_id


def _v4_strings(strings: dict[str, Any]) -> dict[str, Any]:
    items = strings["items"]
    hero, talent, ability = items.get("hero", {}), items.get("talent", {}), items.get("ability", {})

    def both(field: str, first: dict[str, Any], then: dict[str, Any]) -> dict[str, str]:
        # `_by_name_id` keeps the first entry of an id: an id that is both a talent and an
        # ability button (Tyrael's TyraelAspectofJustice) is named by the list that comes first
        return {_v4_key(k): v for d in (first, then) for k, v in d.get(field, {}).items()}

    return {
        "gamestrings": {
            "unit": {
                "name": hero.get("name", {}),
                "expandedrole": hero.get("expandedRole", {}),
                "lifetype": hero.get("lifeType", {}),
                "energytype": hero.get("energyType", {}),
            },
            "abiltalent": {
                "name": both("name", talent, ability),
                "full": both("fullText", talent, ability),
                "cooldown": both("cooldownText", talent, ability),
            },
            # abilities by their own name (hero_game_ids); v4 had one list for both
            "ability": {"name": both("name", ability, talent)},
        }
    }


def from_v5(
    herodata: dict[str, Any], kokr: dict[str, Any], enus: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """heroes-data2 (HeroesDataParser v5) → the heroes-data (v4) shapes the functions above read.
    v5 wraps heroes and strings in {meta, items}, names a talent `talentId` and an ability
    `abilityId` (v4: `nameId`), capitalises tiers, and keys strings by `linkId`
    (`<id>|<button>|<type>…` — the id first, as v4's keys)."""
    heroes: dict[str, Any] = {}
    for hid, h in herodata["items"].items():
        # the hero's other units (the three vikings, Medivh's raven, D.Va's pilot…) carry
        # their own abilities under heroUnits; v4 listed them with the hero's
        units = [h, *(h.get("heroUnits") or {}).values()]
        abilities: dict[str, list[dict[str, Any]]] = {}
        for u in units:
            for tier, items in _v4_tiers(u.get("abilities") or {}, "abilityId").items():
                abilities.setdefault(tier, []).extend(items)
        heroes[hid] = {
            **h,
            "talents": _v4_tiers(h.get("talents") or {}, "talentId"),
            "abilities": abilities,
            "subAbilities": [
                {parent: _v4_tiers(tiers, "abilityId")}
                for u in units
                for parent, tiers in (u.get("subAbilities") or {}).items()
            ],
        }
    return heroes, _v4_strings(kokr), _v4_strings(enus)


def fetch(url: str, dest: Path) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        with urlopen(url, timeout=60) as r:  # noqa: S310 - fixed GitHub raw host
            dest.write_bytes(r.read())
        return True
    except Exception:  # noqa: BLE001
        return False


def unpack_release(tar: Path, b: str, cache: Path) -> None:
    """The release tarball's hero data and kokr/enus strings → cache/{herodata,kokr,enus}_<b>.json
    (found by file name: the archive carries the CI runner's path)."""
    want = {
        f"herodata_{b}.json": f"herodata_{b}.json",
        f"gamestrings_{b}_kokr.json": f"kokr_{b}.json",
        f"gamestrings_{b}_enus.json": f"enus_{b}.json",
    }
    cache.mkdir(parents=True, exist_ok=True)
    with tarfile.open(tar, "r:gz") as t:
        for m in t.getmembers():
            name = Path(m.name).name
            if m.isfile() and name in want:
                f = t.extractfile(m)
                if f is not None:
                    (cache / want[name]).write_bytes(f.read())
    missing = [n for n in want.values() if not (cache / n).exists()]
    if missing:
        raise SystemExit(f"release {tar.name} lacks {missing}")


def resize(src: Path, dst: Path, px: int) -> None:
    subprocess.run(
        ["sips", "-Z", str(px), str(src), "--out", str(dst)], capture_output=True, check=False
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", required=True, help="heroes-data2 release, e.g. 2.57.0.98304")
    ap.add_argument("--data", default="data")
    ap.add_argument("--cache", default=".cache/htc")
    ap.add_argument("--skip-icons", action="store_true", help="tables only, no image downloads")
    args = ap.parse_args()
    data = Path(args.data)
    cache = Path(args.cache)
    b = args.build.split(".")[-1]
    herodata_p = cache / f"herodata_{b}.json"
    kokr_p = cache / f"kokr_{b}.json"
    enus_p = cache / f"enus_{b}.json"
    if not all(p.exists() for p in (herodata_p, kokr_p, enus_p)):
        url = RELEASE.format(build=args.build)
        tar = cache / f"heroes-data-{args.build}.tar.gz"
        if not tar.exists() and not fetch(url, tar):
            raise SystemExit(f"download failed: {url}")
        unpack_release(tar, b, cache)
    herodata = json.loads(herodata_p.read_text(encoding="utf-8"))
    kokr = json.loads(kokr_p.read_text(encoding="utf-8"))
    enus = json.loads(enus_p.read_text(encoding="utf-8"))
    if "items" in herodata:  # heroes-data2 (v5); a heroes-data (v4) cache is read as it is
        herodata, kokr, enus = from_v5(herodata, kokr, enus)

    # talents
    talents = talent_table(herodata, kokr)
    # every talent's icon, not only today's builds: the builds change daily, so any talent can
    # reach a hero page tomorrow (narrowing this to one day's builds left Illidan's icons 404)
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
    heroes, missing_heroes = hero_rows(herodata, kokr, names, table["roles"], enus)
    if missing_heroes:
        log.warning(
            "assets.heroes_without_game_data",
            heroes=missing_heroes,
            build=args.build,
            note="not shown on the site until a heroes-data build has them",
        )
    table["heroes"] = heroes
    role_en = role_names(kokr, enus)
    table["roles"] = [r | {"en": role_en.get(r["ko"], r["name"])} for r in table["roles"]]
    table["source"]["names"] = (
        f"HeroesToolChest/heroes-data2 gamestrings kokr + enus (build {b}, MIT)"
    )
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
    source = (
        f"HeroesToolChest heroes-data2 {args.build} (gamestrings kokr, enus) + heroes-images, MIT"
    )
    out_dir = data / "talents"
    out_dir.mkdir(parents=True, exist_ok=True)
    game = hero_game_ids(herodata, kokr, heroes, enus)
    for hero_slug, table in hero_talent_files(herodata, kokr, heroes, enus).items():
        body = {"source": source, "talents": table, "game": game.get(hero_slug)}
        (out_dir / f"{hero_slug}.json").write_text(
            json.dumps(body, ensure_ascii=False, separators=(",", ":")),
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
