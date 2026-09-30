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

HOTFIX_PARSER = 1

# attributes that name a slot rather than hold a value
_KEY_ATTRS = {"id", "index", "parent"}


@dataclass(frozen=True)
class NumericChange:
    entry: str
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


def _flatten(xml: str) -> tuple[dict[str, tuple[str, float, tuple[str, ...]]], list[str]]:
    """{entry key + element path + attribute: (entry id, value, context)}, in document order."""
    root = ET.fromstring(xml)
    consts = {
        str(c.get("id")): str(c.get("value"))
        for c in root
        if c.tag == "const" and c.get("id") and c.get("value") is not None
    }
    out: dict[str, tuple[str, float, tuple[str, ...]]] = {}
    order: list[str] = []
    seen_entries: dict[tuple[str, str], int] = {}

    def walk(el: ET.Element, entry: str, path: str) -> None:
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
                    out[key] = (entry, v, context)
                    order.append(key)
            walk(child, entry, here)

    for el in root:
        eid = el.get("id")
        if el.tag == "const" or not eid:
            continue
        n = seen_entries.get((el.tag, eid), 0)
        seen_entries[(el.tag, eid)] = n + 1
        walk(el, eid, f"{el.tag}[{eid}#{n}]")
    return out, order


def numeric_changes(old_xml: str, new_xml: str) -> list[NumericChange]:
    """Numbers at the same place in both builds that differ (consts resolved), new-file order."""
    old, _ = _flatten(old_xml)
    new, order = _flatten(new_xml)
    changes = []
    for key in order:
        if key not in old:
            continue
        entry, v_new, context = new[key]
        v_old = old[key][1]
        if _fmt(v_old) != _fmt(v_new):
            changes.append(NumericChange(entry, key, _fmt(v_old), _fmt(v_new), context))
    return changes


def _hero_prefix(ids: list[str]) -> str:
    """The first CamelCase word most talent ids start with ("Chromie"); Generic… ids aside."""
    words = [m.group(0) for i in ids if (m := re.match(r"[A-Z][a-z]+", i))]
    if not words:
        return ""
    top = max(set(words), key=words.count)
    return top if words.count(top) * 2 >= len(ids) else ""


class TalentIndex:
    """Talent nameIds per hero slug (data/talents), and the API hero name of each slug."""

    def __init__(self, talents: dict[str, dict[str, dict[str, Any]]], names: dict[str, str]):
        self.talents = talents
        self.names = names
        self._owner = {nid: slug for slug, ts in talents.items() for nid in ts}
        # the hero's own prefix ("Chromie"), stripped to match a talent named inside another id
        self._prefix = {slug: _hero_prefix(list(ts)) for slug, ts in talents.items() if ts}

    @classmethod
    def load(cls, data_dir: Path) -> TalentIndex:
        heroes = json.loads((data_dir / "heroes_ko.json").read_text(encoding="utf-8"))
        names = {h["slug"]: h["name"] for h in heroes["heroes"]}
        talents = {}
        for p in sorted((data_dir / "talents").glob("*.json")):
            if p.stem in names:
                talents[p.stem] = json.loads(p.read_text(encoding="utf-8"))["talents"]
        return cls(talents, names)

    def owner(self, c: NumericChange) -> tuple[str, str] | None:
        # 1. the entry is named after the talent: ChenMasteryKegSmashATouchOfHoney, …Accumulator
        named = [nid for nid in self._owner if c.entry.startswith(nid)]
        if named:
            nid = max(named, key=len)
            return self._owner[nid], nid
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
        return (best[1], best[2]) if best else None


def hero_changes(
    files: list[tuple[str, str]], index: TalentIndex
) -> dict[str, list[dict[str, Any]]]:
    """API hero name → talents with their changed numbers (each old → new pair once)."""
    heroes: dict[str, dict[str, dict[str, Any]]] = {}
    for old, new in files:
        for c in numeric_changes(old, new):
            own = index.owner(c)
            if own is None:
                continue
            slug, nid = own
            talent = heroes.setdefault(index.names[slug], {}).setdefault(
                nid,
                {
                    "talent": nid,
                    "ko": index.talents[slug][nid].get("ko"),
                    "en": index.talents[slug][nid].get("en"),
                    "changes": [],
                },
            )
            pair = {"old": c.old, "new": c.new}
            if pair not in talent["changes"]:
                talent["changes"].append(pair)
    return {hero: list(ts.values()) for hero, ts in heroes.items()}


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
