"""End-of-match awards: HP's award ids → the game's award keys (data/awards.json).

HP names an award by its own `award_id`; match lists carry only that id. Two tables ship with the
server, both written by tools/build_awards.py: `hp_awards.json` (ids seen so far → key) and
`game_awards.json` (every game award: English name and icon stem, HeroesToolChest heroes-data).
An id the shipped table lacks is resolved from the title and icon a /replay/{id} answer gives
(title first: HP sends the Avenger icon with Bulwark) and remembered in `hp_award_map`, so the
server learns new ids by itself. An award the game data lacks stays unnamed and is logged
(`awards.unresolved`): rerun tools/build_awards.py with a newer heroes-data build.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

import structlog

from server.players.store import HPStore

log = structlog.get_logger(__name__)

_HERE = Path(__file__).parent
HP_AWARDS: dict[str, str] = json.loads((_HERE / "hp_awards.json").read_text())
GAME_AWARDS: dict[str, dict[str, str]] = json.loads((_HERE / "game_awards.json").read_text())


def _norm(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower())


def resolve_with(
    title: str | None, icon: str | None, game: dict[str, dict[str, str]]
) -> str | None:
    """The game award HP means: English name equal to HP's title, else the icon HP sent."""
    if title:
        for key, a in game.items():
            if _norm(a["en"]) == _norm(title):
                return key
    if icon:
        for key, a in game.items():
            if a["icon"] == icon:
                return key
    return None


def resolve_key(title: str | None, icon: str | None) -> str | None:
    return resolve_with(title, icon, GAME_AWARDS)


class AwardBook:
    """HP award ids → game keys: the shipped table, then what this server has learned."""

    def __init__(self, store: HPStore, clock: Callable[[], float]) -> None:
        self._store = store
        self._clock = clock

    async def key(self, award_id: str | None) -> str | None:
        if award_id is None:
            return None
        return HP_AWARDS.get(award_id) or await self._store.learned_award(award_id)

    async def table(self) -> dict[str, str]:
        return {**await self._store.learned_awards(), **HP_AWARDS}

    async def learn(self, award_id: str, title: str | None, icon: str | None) -> str | None:
        known = await self.key(award_id)
        if known is not None:
            return known
        key = resolve_key(title, icon)
        if key is None:
            log.warning("awards.unresolved", award_id=award_id, title=title, icon=icon)
            return None
        await self._store.learn_award(award_id, key, title or "", self._clock())
        log.info("awards.learned", award_id=award_id, key=key)
        return key


def award_parts(a: Any) -> tuple[str | None, str | None, str | None]:
    """(id, title, icon) of a /replay award object; all None when there is no award."""
    if not isinstance(a, dict) or a.get("award_id") is None:
        return None, None, None
    title, icon = a.get("title"), a.get("icon")
    return (
        str(a["award_id"]),
        title if isinstance(title, str) else None,
        icon if isinstance(icon, str) else None,
    )
