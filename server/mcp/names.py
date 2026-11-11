"""Hero, map and role names in English (HP's) and Korean (the game's), from the site's data files
(data/heroes_ko.json, data/maps_ko.json: HeroesToolChest gamestrings). A tool accepts either."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _key(name: str) -> str:
    return "".join(name.split()).casefold()


class GameNames:
    def __init__(self, data_dir: Path) -> None:
        heroes = _load(data_dir / "heroes_ko.json")
        maps = _load(data_dir / "maps_ko.json")
        self._hero_ko = {h["name"]: h["ko"] for h in heroes.get("heroes", [])}
        self._hero_role = {h["name"]: h.get("role") for h in heroes.get("heroes", [])}
        self._hero_slug = {h["name"]: h.get("slug") for h in heroes.get("heroes", [])}
        self._map_ko = {m["name"]: m["ko"] for m in maps.get("maps", [])}
        roles = heroes.get("roles", [])
        self._heroes = _index(self._hero_ko)
        self._maps = _index(self._map_ko)
        self._roles = _index({r["name"]: r["ko"] for r in roles})

    def hero_ko(self, name: str | None) -> str | None:
        return self._hero_ko.get(name) if name else None

    def hero_role(self, name: str | None) -> str | None:
        return self._hero_role.get(name) if name else None

    def hero_slug(self, name: str | None) -> str | None:
        return self._hero_slug.get(name) if name else None

    def map_ko(self, name: str | None) -> str | None:
        return self._map_ko.get(name) if name else None

    def hero(self, name: str) -> str | None:
        """HP's hero name for an English or Korean name (spacing and case ignored)."""
        return self._heroes.get(_key(name))

    def map(self, name: str) -> str | None:
        return self._maps.get(_key(name))

    def role(self, name: str) -> str | None:
        return self._roles.get(_key(name))


def _index(en_to_ko: dict[str, str]) -> dict[str, str]:
    out = {_key(en): en for en in en_to_ko}
    out.update({_key(ko): en for en, ko in en_to_ko.items()})
    return out


def _load(path: Path) -> dict[str, Any]:
    try:
        data: Any = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}
