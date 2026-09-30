"""Unannounced hotfixes (#62): the numbers that changed between two builds' hero XML.

Blizzard ships balance hotfixes without notes (2.55.17.97650: seven heroes). The only record
is the game data itself, fetched per build from the public CDN (tools/hotfix/). This module
reads two versions of a hero's XML and keeps what the page can say without inventing words:
a talent's name and its numbers, old → new. Rewired effects, validators and visuals have
no number to show and are left out; so is any change no talent is named after.
"""

from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Any

HOTFIX_PARSER = 3

# attributes that name a slot rather than hold a value
_KEY_ATTRS = {"id", "index", "parent"}


@dataclass(frozen=True)
class NumericChange:
    entry: str
    tag: str  # the entry's catalog class: CUnit, CWeaponLegacy, CEffectDamage, CTalent, …
    path: str
    old: str
    new: str
    # the changed element's other attribute values (validators, indexes): what it is gated on
    context: tuple[str, ...]


def _num(raw: str | None, consts: dict[str, str]) -> float | None:
    seen = 0
    while raw is not None and raw.startswith("$") and seen < 8:
        raw = consts.get(raw)
        seen += 1
    if raw is None:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _fmt(v: float) -> str:
    s = f"{v:.6f}".rstrip("0").rstrip(".")
    return "0" if s in {"-0", ""} else s


_Flat = dict[str, tuple[str, str, float, tuple[str, ...]]]


def _flatten(xml: str) -> tuple[_Flat, list[str]]:
    """{entry key + element path + attribute: (entry id, tag, value, context)}, document order."""
    root = ET.fromstring(xml)
    consts = {
        str(c.get("id")): str(c.get("value"))
        for c in root
        if c.tag == "const" and c.get("id") and c.get("value") is not None
    }
    out: _Flat = {}
    order: list[str] = []
    seen_entries: dict[tuple[str, str], int] = {}

    def walk(el: ET.Element, entry: str, tag: str, path: str) -> None:
        counts: dict[str, int] = {}
        for child in el:
            n = counts.get(child.tag, 0)
            counts[child.tag] = n + 1
            slot = child.get("index") or str(n)
            here = f"{path}/{child.tag}[{slot}]"
            context = tuple(str(v) for k, v in child.attrib.items() if not v.startswith("$"))
            for k, raw in child.attrib.items():
                if k in _KEY_ATTRS:
                    continue
                v = _num(raw, consts)
                if v is not None:
                    key = f"{here}@{k}"
                    out[key] = (entry, tag, v, context)
                    order.append(key)
            walk(child, entry, tag, here)

    for el in root:
        eid = el.get("id")
        if el.tag == "const" or not eid:
            continue
        n = seen_entries.get((el.tag, eid), 0)
        seen_entries[(el.tag, eid)] = n + 1
        walk(el, eid, el.tag, f"{el.tag}[{eid}#{n}]")
    return out, order


def numeric_changes(old_xml: str, new_xml: str) -> list[NumericChange]:
    """Numbers at the same place in both builds that differ (consts resolved), new-file order."""
    old, _ = _flatten(old_xml)
    new, order = _flatten(new_xml)
    changes = []
    for key in order:
        if key not in old:
            continue
        entry, tag, v_new, context = new[key]
        v_old = old[key][2]
        if _fmt(v_old) != _fmt(v_new):
            changes.append(NumericChange(entry, tag, key, _fmt(v_old), _fmt(v_new), context))
    return changes


def _hero_prefix(ids: list[str]) -> str:
    """The first CamelCase word most talent ids start with ("Chromie"); Generic… ids aside."""
    words = [m.group(0) for i in ids if (m := re.match(r"[A-Z][a-z]+", i))]
    if not words:
        return ""
    top = max(set(words), key=words.count)
    return top if words.count(top) * 2 >= len(ids) else ""


# Base stat words as the game's own strings write them (gamestrings 97039: 일반 공격력 ×85,
# 공격 속도 ×97, 일반 공격 사거리 ×26, 생명력/마나 재생량; en Basic Attack Damage, Attack Speed,
# Basic Attack Range, Health/Mana Regeneration). Life and energy come per hero (lifetype,
# energytype: 생명력, 마나, 기력, 분노, …).
_REGEN = {"ko": "{} 재생량", "en": "{} Regeneration"}
_WEAPON_WORDS = {
    "Range": {"ko": "일반 공격 사거리", "en": "Basic Attack Range"},
    "Period": {"ko": "공격 속도", "en": "Attack Speed"},
}
_DAMAGE_WORDS = {"ko": "일반 공격력", "en": "Basic Attack Damage"}

_KIND_ORDER = {"base": 0, "ability": 1, "talent": 2}


@dataclass(frozen=True)
class Owner:
    slug: str
    kind: str  # base | ability | talent
    id: str
    label: dict[str, str] | None = None  # base stats: the stat's word


def _leaf(c: NumericChange) -> str:
    """ "…/LifeMax[0]@value" → "LifeMax" (only a value attribute counts as a stat)."""
    last = c.path.rsplit("/", 1)[-1]
    return last.split("[", 1)[0] if last.endswith("@value") else ""


class TalentIndex:
    """Per hero slug (data/talents): talent nameIds, and the game ids of its unit, weapons and
    abilities (`game`, tools/build_assets.py); plus the API hero name of each slug."""

    def __init__(
        self,
        talents: dict[str, dict[str, dict[str, Any]]],
        names: dict[str, str],
        game: dict[str, dict[str, Any]] | None = None,
    ):
        self.talents = talents
        self.names = names
        self.game = game or {}
        self._owner = {nid: slug for slug, ts in talents.items() for nid in ts}
        # the hero's own prefix ("Chromie"), stripped to match a talent named inside another id
        self._prefix = {slug: _hero_prefix(list(ts)) for slug, ts in talents.items() if ts}
        self._weapons = {w: slug for slug, g in self.game.items() for w in g.get("weapons", [])}

    @classmethod
    def load(cls, data_dir: Path) -> TalentIndex:
        heroes = json.loads((data_dir / "heroes_ko.json").read_text(encoding="utf-8"))
        names = {h["slug"]: h["name"] for h in heroes["heroes"]}
        talents, game = {}, {}
        for p in sorted((data_dir / "talents").glob("*.json")):
            if p.stem in names:
                body = json.loads(p.read_text(encoding="utf-8"))
                talents[p.stem] = body["talents"]
                if body.get("game"):
                    game[p.stem] = body["game"]
        return cls(talents, names, game)

    def weapon_effects(self, xml: str) -> dict[str, str]:
        """Damage effect id → weapon id, as the build's own weapons name them (DisplayEffect)."""
        out = {}
        for el in ET.fromstring(xml):
            if el.tag.startswith("CWeapon") and el.get("id") in self._weapons:
                for d in el.iter("DisplayEffect"):
                    if d.get("value"):
                        out[str(d.get("value"))] = str(el.get("id"))
        return out

    def _talent(self, c: NumericChange) -> Owner | None:
        # 1. the entry is named after the talent: ChenMasteryKegSmashATouchOfHoney, …Accumulator
        named = [nid for nid in self._owner if c.entry.startswith(nid)]
        if named:
            nid = max(named, key=len)
            return Owner(self._owner[nid], "talent", nid)
        # 2. the talent is named inside the entry (GallShadowflameDoubleTrouble… names
        #    GallDoubleTrouble)
        #    or in what the change is gated on: Validator="ChromieCreatorDoesHaveSandBlast
        #    OnceAgainTheFirstTimeQuestCompleteBehavior" names ChromieSandBlastOnceAgainTheFirstTime
        where = (c.entry[1:], *c.context)  # [1:]: the whole id is rule 1's
        best: tuple[int, str, str] | None = None
        for slug, prefix in self._prefix.items():
            if len(prefix) < 3 or not c.entry.startswith(prefix):
                continue
            for nid in self.talents[slug]:
                core = nid[len(prefix) :]
                hit = len(core) >= 6 and any(core in v for v in where)
                if hit and (best is None or len(core) > best[0]):
                    best = (len(core), slug, nid)
        return Owner(best[1], "talent", best[2]) if best else None

    def _base(self, c: NumericChange, effects: dict[str, str]) -> Owner | None:
        leaf = _leaf(c)
        if c.tag == "CUnit":
            for slug, g in self.game.items():
                unit = g.get("unit", "")
                rest = c.entry[len(unit) :]
                if not unit or not c.entry.startswith(unit) or (rest and not rest[0].isupper()):
                    continue  # HeroCho is not HeroChromie; HeroAlexstraszaDragon is Alexstrasza
                life, energy = g.get("life"), g.get("energy")
                words = {
                    "LifeMax": life,
                    "LifeRegenRate": life and {k: _REGEN[k].format(v) for k, v in life.items()},
                    "EnergyMax": energy,
                    "EnergyRegenRate": energy
                    and {k: _REGEN[k].format(v) for k, v in energy.items()},
                }.get(leaf)
                return Owner(slug, "base", "base", words) if words else None
        if c.tag.startswith("CWeapon") and c.entry in self._weapons and leaf in _WEAPON_WORDS:
            return Owner(self._weapons[c.entry], "base", "base", _WEAPON_WORDS[leaf])
        if c.tag == "CEffectDamage" and c.entry in effects and leaf == "Amount":
            return Owner(self._weapons[effects[c.entry]], "base", "base", _DAMAGE_WORDS)
        return None

    def _ability(self, c: NumericChange) -> Owner | None:
        best: tuple[int, str, str] | None = None
        for slug, g in self.game.items():
            for aid in g.get("abilities", {}):
                if c.entry.startswith(aid) and (best is None or len(aid) > best[0]):
                    best = (len(aid), slug, aid)
        return Owner(best[1], "ability", best[2]) if best else None

    def owner(self, c: NumericChange, effects: dict[str, str] | None = None) -> Owner | None:
        """Talents first (an ability's id is the start of many talent entries), then the
        unit's and weapon's stats, then the ability the entry is named after."""
        return self._talent(c) or self._base(c, effects or {}) or self._ability(c)

    def describe(self, own: Owner) -> dict[str, Any]:
        if own.kind == "talent":
            t = self.talents[own.slug][own.id]
            return {"kind": "talent", "id": own.id, "ko": t.get("ko"), "en": t.get("en")}
        if own.kind == "ability":
            a = self.game[own.slug]["abilities"][own.id]
            return {"kind": "ability", "id": own.id, "ko": a["ko"], "en": a["en"], "key": a["key"]}
        return {"kind": "base", "id": "base", "ko": None, "en": None}


def _same(c: NumericChange) -> tuple[str, str, str]:
    return (c.path.rsplit("/", 1)[-1], c.old, c.new)


def _per_second(period: str) -> str:
    return _fmt(round(1 / float(period), 2)) if float(period) else period


def hero_changes(
    files: list[tuple[str, str]], index: TalentIndex
) -> dict[str, list[dict[str, Any]]]:
    """API hero name → base stats, abilities and talents with their changed numbers (each
    old → new pair once), base first as the patch notes order them."""
    heroes: dict[str, dict[tuple[str, str], dict[str, Any]]] = {}
    for old, new in files:
        effects = index.weapon_effects(new)
        changes = [(c, index.owner(c, effects)) for c in numeric_changes(old, new)]
        # the same number changed the same way outside every owner too (Mal'Ganis's leech on
        # every damage effect): the hero's trait changed, not the talents or abilities
        shared = {_same(c) for c, own in changes if own is None}
        for c, own in changes:
            if own is None or _same(c) in shared:
                continue
            item = heroes.setdefault(index.names[own.slug], {}).setdefault(
                (own.kind, own.id), {**index.describe(own), "changes": []}
            )
            pair: dict[str, Any] = {"old": c.old, "new": c.new}
            if own.label is not None:
                if _leaf(c) == "Period":  # the game shows attack speed as attacks per second
                    pair = {"old": _per_second(c.old), "new": _per_second(c.new)}
                pair["label"] = own.label
            if pair not in item["changes"]:
                item["changes"].append(pair)
    return {
        hero: sorted(items.values(), key=lambda i: _KIND_ORDER[i["kind"]])
        for hero, items in heroes.items()
    }


def hotfix_record(
    *,
    build: str,
    previous: str,
    first_seen: str,
    files: list[tuple[str, str]],
    index: TalentIndex,
) -> dict[str, Any]:
    return {
        "build": build,
        "previous": previous,
        "first_seen": first_seen,
        "parser": HOTFIX_PARSER,
        "heroes": hero_changes(files, index),
    }


def save_record(path: Path, record: dict[str, Any]) -> None:
    """Add or replace one build's record in data/hotfixes.json; newest build first."""
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"builds": []}
    builds = [b for b in data["builds"] if b["build"] != record["build"]] + [record]
    builds.sort(key=lambda b: tuple(int(x) for x in b["build"].split(".")), reverse=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps({"builds": builds}, ensure_ascii=False, indent=1) + "\n", "utf-8")
    tmp.replace(path)
