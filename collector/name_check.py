"""Names in a weekly report are the game's own (owner 2026-10-06: "퀴라가 아니라 키히라").

The Korean and English texts say the same thing, so every hero named in the English text, and
every ability and talent of those heroes named there, must appear in the Korean text under its
official Korean name (data/heroes_ko.json; data/talents/<slug>.json `game.abilities` and
`talents`). A name written from memory ("퀴라", "브라이트윙") is then caught before review.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


def _named(name: str, text: str) -> bool:
    return re.search(rf"(?<![A-Za-z']){re.escape(name)}(?![A-Za-z])", text) is not None


def _text(analysis: dict[str, Any], lang: str) -> str:
    return " ".join([analysis.get("title", {}).get(lang, ""), *analysis["paragraphs"][lang]])


def name_mismatches(analysis: dict[str, Any], data_dir: Path) -> list[dict[str, str]]:
    en, ko = _text(analysis, "en"), _text(analysis, "ko")
    table = json.loads((data_dir / "heroes_ko.json").read_text(encoding="utf-8"))["heroes"]
    out: list[dict[str, str]] = []
    # an English name can be two heroes' (Diablo's ability Overpower 압도, Varian's talent 제압):
    # it passes when any of its Korean names is in the Korean text
    kit_names: dict[str, list[tuple[str, str]]] = {}
    for h in table:
        if not _named(h["name"], en):
            continue
        if h["ko"] not in ko:
            out.append({"en": h["name"], "ko": h["ko"], "kind": "hero"})
        path = data_dir / "talents" / f"{h['slug']}.json"
        if not path.exists():
            continue
        kit = json.loads(path.read_text(encoding="utf-8"))
        for kind, items in (
            ("ability", (kit.get("game") or {}).get("abilities", {}).values()),
            ("talent", (kit.get("talents") or {}).values()),
        ):
            for x in items:
                if x.get("en") and x.get("ko"):
                    kit_names.setdefault(x["en"], []).append((kind, x["ko"]))
    for name_en, options in kit_names.items():
        if _named(name_en, en) and not any(k in ko for _, k in options):
            kind, name_ko = options[0]
            out.append({"en": name_en, "ko": name_ko, "kind": kind})
    return out
