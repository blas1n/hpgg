"""Blizzard's official patch notes → each hero's changes, with a direction per line (#62).

The notes are server-rendered HTML with one fixed shape in every language:
``<a name="Balance">`` … ``<h4>Hero</h4>`` → ``<p><strong>Base|Talents</strong></p>`` →
``<ul><li><strong>Level N</strong><ul><li><strong>Ability</strong><ul><li>change``.
Korean and English are both Blizzard's own text, so hero and ability names match the game.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from html.parser import HTMLParser
from typing import Any, Literal

import httpx
import structlog

Direction = Literal["up", "down", "neutral"]
Verdict = Literal["buff", "nerf", "mixed"]
Section = Literal["base", "talents"]

SECTIONS: dict[str, Section] = {
    "Base": "base",
    "기본": "base",
    "Talents": "talents",
    "특성": "talents",
}
_LEVEL = re.compile(r"^(?:Level (\d+)|(\d+)레벨)$")


@dataclass
class Change:
    text: str
    direction: Direction


@dataclass
class Group:
    section: Section
    level: int | None
    ability: str | None
    changes: list[Change] = field(default_factory=list)


@dataclass
class HeroEntry:
    name: str
    groups: list[Group] = field(default_factory=list)


@dataclass
class _Node:
    tag: str
    attrs: dict[str, str | None]
    children: list[_Node | str] = field(default_factory=list)

    def text(self) -> str:
        if self.tag in _STRUCK:
            return ""
        return "".join(c if isinstance(c, str) else c.text() for c in self.children)


# Blizzard strikes a retracted change whole and an old value inline ("<s>35</s> 40"):
# neither is part of the note any more
_STRUCK = {"s", "del", "strike"}


_VOID = {"br", "hr", "img", "meta", "link", "input", "source"}


class _Tree(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = _Node("root", {})
        self._stack = [self.root]

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        node = _Node(tag, dict(attrs))
        self._stack[-1].children.append(node)
        if tag not in _VOID:
            self._stack.append(node)

    def handle_endtag(self, tag: str) -> None:
        for i in range(len(self._stack) - 1, 0, -1):
            if self._stack[i].tag == tag:
                del self._stack[i:]
                return

    def handle_data(self, data: str) -> None:
        self._stack[-1].children.append(data)


_BALANCE_HEADINGS = {"Balance Update", "Balance Updates", "밸런스 업데이트"}


def _balance_nodes(html: str) -> list[_Node | str]:
    """Nodes of the balance section: from the Balance anchor (or, in older notes without anchors,
    the Balance heading) to the next anchor or top heading."""
    tree = _Tree()
    tree.feed(html)
    flat: list[_Node | str] = []

    def walk(n: _Node) -> None:
        for c in n.children:
            flat.append(c)
            if isinstance(c, _Node) and c.tag not in {"h2", "h4", "p", "ul"}:
                walk(c)

    walk(tree.root)
    out: list[_Node | str] = []
    inside = False
    for n in flat:
        if not isinstance(n, _Node):
            continue
        anchor = n.tag == "a" and n.attrs.get("name")
        start = (anchor and n.attrs.get("name") == "Balance") or (
            n.tag == "h2" and _clean(n.text()) in _BALANCE_HEADINGS
        )
        if inside and (anchor or (n.tag == "h2" and not start)):
            break
        if start:
            inside = True
            continue
        if inside:
            out.append(n)
    return out


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def _lis(ul: _Node) -> list[_Node]:
    return [c for c in ul.children if isinstance(c, _Node) and c.tag == "li"]


def _walk_list(
    ul: _Node,
    hero: HeroEntry,
    section: Section,
    level: int | None,
    ability: str | None,
    locale: str,
) -> None:
    for li in _lis(ul):
        label = next((c for c in li.children if isinstance(c, _Node) and c.tag == "strong"), None)
        sub = [c for c in li.children if isinstance(c, _Node) and c.tag == "ul"]
        if label is not None and sub:
            name = _clean(label.text())
            m = _LEVEL.match(name)
            lv, ab = (int(m.group(1) or m.group(2)), None) if m else (level, name)
            for s in sub:
                _walk_list(s, hero, section, lv, ab, locale)
            continue
        text = _clean(li.text())
        if not text:
            continue
        last = hero.groups[-1] if hero.groups else None
        if last is None or (last.section, last.level, last.ability) != (section, level, ability):
            last = Group(section, level, ability)
            hero.groups.append(last)
        last.changes.append(Change(text, direction(text, locale)))


def parse_balance(html: str, locale: str) -> list[HeroEntry]:
    heroes: list[HeroEntry] = []
    section: Section | None = None
    for n in _balance_nodes(html):
        if not isinstance(n, _Node):
            continue
        if n.tag == "h4":
            heroes.append(HeroEntry(_clean(n.text())))
            section = None
        elif n.tag == "p" and heroes:
            section = SECTIONS.get(_clean(n.text()), section)
        elif n.tag == "ul" and heroes and section is not None:
            _walk_list(n, heroes[-1], section, None, None, locale)
    return [h for h in heroes if h.groups]


# --- direction of one change line -------------------------------------------------------------

_NUM = r"(-?(?:\d[\d,]*(?:\.\d+)?|\.\d+))"
_MORE = r"(?:/[\d.,]+)*"  # "75/125" → the first value speaks for the rest
_VERB_EN = r"(?:increased|reduced|decreased|lowered|raised)"
# (old, new) readings, first match wins; group 2 is the old value unless the pattern says new-first
_READINGS: dict[str, list[tuple[re.Pattern[str], bool]]] = {
    "en-us": [
        # "increased to 85/150, up from 75/125" — the new value first
        (
            re.compile(
                rf"^(?P<subject>.*?)(?<![\w.]){_NUM}{_MORE}[^\d]*?\b(?:up|down) from {_NUM}"
            ),
            True,
        ),
        # "Cooldown increased from 45 to 75 seconds." / "Cooldown increased 45 to 60 seconds."
        (re.compile(rf"^(?P<subject>.*?)(?:from|{_VERB_EN}) {_NUM}{_MORE}\D*? to {_NUM}"), False),
        # "energy cost increased to 35 from 30"
        (re.compile(rf"^(?P<subject>.*?)\bto {_NUM}[\d\s/.,]*?\bfrom {_NUM}"), True),
    ],
    "ko-kr": [
        # "재사용 대기시간이 45초에서 75초로 증가했습니다." — the subject precedes the first number
        (re.compile(rf"^(?P<subject>.*?)(?<![\w.]){_NUM}{_MORE}[^\d]*?에서\s*{_NUM}"), False),
    ],
}
# "Range increased by 1." / "사거리가 1 증가했습니다." — changed by an amount: the verb says the way
_BY = {
    # the whole line, so a talent's description ("… is increased by 20% and …") does not count
    "en-us": re.compile(
        rf"^(?P<subject>[^\d.]*?) (?:is )?(?P<verb>{_VERB_EN}) by {_NUM}\S*(?: \w+)?\.?$"
    ),
    "ko-kr": re.compile(
        rf"^(?P<subject>[^\d]*?)[이가] {_NUM}\S* (?P<verb>증가|감소)(?:했습니다|합니다)\.?$"
    ),
}
_UP_VERBS = {"increased", "raised", "증가"}
# the change is not a plain up/down of one number
_NEUTRAL = {
    # adjusted/moved/"but", a total that stays the same, a rate ("once every 6 seconds")
    "en-us": re.compile(
        r"\b(adjusted|moved|but|once every)\b"
        r"|total [\w ]+ (?:is unchanged|remains the same|stays? the same)|level \d+ to level",
        re.I,
    ),
    "ko-kr": re.compile(
        r"조정|레벨로 이동|하지만|했으나|총 [^ ]+ 그대로|총 .*동일|레벨에서|초당 \d+번"
    ),
}
# a reduction/increase the hero applies: more of it is better, whatever it reduces
_EFFECT = {
    "en-us": re.compile(r"reduction|increase\b", re.I),
    "ko-kr": re.compile(r"감소량|증가량|감소 효과|감소하는"),
}
# less is better
_LOWER = {
    "en-us": re.compile(
        r"cooldown|mana cost|cost\b|cast time|requirement|required|delay|damage taken", re.I
    ),
    "ko-kr": re.compile(r"재사용 대기시간|소모량|시전 시간|조건|필요|요구|지연|받는 피해"),
}


def _more_is_better(subject: str, locale: str) -> bool:
    return bool(_EFFECT[locale].search(subject)) or not _LOWER[locale].search(subject)


def direction(text: str, locale: str) -> Direction:
    if _NEUTRAL[locale].search(text):
        return "neutral"
    for pattern, new_first in _READINGS[locale]:
        m = pattern.search(text)
        if not m:
            continue
        x, y = (abs(float(v.replace(",", ""))) for v in (m.group(2), m.group(3)))
        a, b = (y, x) if new_first else (x, y)
        if a == b:
            return "neutral"
        # the property can follow the first number ("a 1 second cooldown …, down from 2 seconds")
        subject = text[: m.start(3)]
        return "up" if (b > a) == _more_is_better(subject, locale) else "down"
    m = _BY[locale].search(text)
    if m:
        grew = m.group("verb") in _UP_VERBS
        return "up" if grew == _more_is_better(m.group("subject"), locale) else "down"
    return "neutral"


def verdict(directions: list[Direction]) -> Verdict:
    if directions and all(d == "up" for d in directions):
        return "buff"
    if directions and all(d == "down" for d in directions):
        return "nerf"
    return "mixed"


# --- collection: the news list → new notes → one JSON record per note ---------------------------

NEWS = "https://news.blizzard.com/{locale}/api/news/heroes-of-the-storm"
ARTICLE = "https://news.blizzard.com/{locale}/article/{id}/"
LOCALES = {"ko": "ko-kr", "en": "en-us"}
# a note is published the evening before its build; a build listed this long around it is its build
BUILD_WINDOW = (timedelta(days=-1), timedelta(days=3))
NOTE_LIMIT = 12
# bump when parsing or direction rules change: every kept note is parsed again
PARSER_VERSION = 2

log = structlog.get_logger(__name__)


def is_patch_note(title_en: str) -> bool:
    """Live and balance notes; PTR notes describe a test server, not the game people play."""
    t = title_en.lower()
    return "patch notes" in t and "ptr" not in t


def _version_key(v: str) -> tuple[int, ...]:
    return tuple(int(x) for x in v.split("."))


def _when(raw: object) -> datetime | None:
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00")) if raw else None
    except ValueError:
        return None


def build_for(published: datetime, patches_payload: dict[str, Any]) -> str | None:
    """The first build (by version) HP listed within BUILD_WINDOW of the note."""
    lo, hi = published + BUILD_WINDOW[0], published + BUILD_WINDOW[1]
    near = [
        str(p["game_version"])
        for p in patches_payload.get("patches", [])
        if isinstance(p.get("game_version"), str)
        and (added := _when(p.get("date_added"))) is not None
        and lo <= added <= hi
    ]
    return min(near, key=_version_key) if near else None


def _items(payload: dict[str, Any]) -> list[dict[str, Any]]:
    items = payload.get("feed", {}).get("contentItems", [])
    return [i["properties"] for i in items if isinstance(i, dict) and "properties" in i]


def _hero_keys(heroes: dict[str, Any]) -> dict[str, str]:
    """Korean and English display names → the API name the rest of the data uses."""
    keys: dict[str, str] = {}
    for h in heroes.get("heroes", []):
        for field_ in ("ko", "en", "name"):
            if h.get(field_):
                keys[str(h[field_])] = str(h["name"])
    return keys


def _record(
    news_id: str,
    published: str,
    titles: dict[str, str],
    parsed: dict[str, list[HeroEntry]],
    keys: dict[str, str],
    build: str | None,
) -> dict[str, Any]:
    heroes: dict[str, Any] = {}
    for ko, en in zip(parsed["ko"], parsed["en"], strict=False):
        key = keys.get(en.name) or keys.get(ko.name) or en.name
        same_shape = [(g.section, g.level, len(g.changes)) for g in ko.groups] == [
            (g.section, g.level, len(g.changes)) for g in en.groups
        ]
        if not same_shape:
            log.warning("patchnotes.shape_mismatch", note=news_id, hero=key)
        groups: list[dict[str, Any]] = []
        dirs: list[Direction] = []
        for i, kg in enumerate(ko.groups):
            eg = en.groups[i] if same_shape else None
            changes = []
            for j, kc in enumerate(kg.changes):
                ec = eg.changes[j] if eg else None
                # two readings of Blizzard's two texts; when they disagree, claim nothing
                d: Direction = kc.direction if ec and ec.direction == kc.direction else "neutral"
                dirs.append(d)
                changes.append({"ko": kc.text, "en": ec.text if ec else None, "direction": d})
            ability = {"ko": kg.ability, "en": eg.ability if eg else None} if kg.ability else None
            groups.append(
                {"section": kg.section, "level": kg.level, "ability": ability, "changes": changes}
            )
        heroes[key] = {"verdict": verdict(dirs), "groups": groups}
    return {
        "id": news_id,
        "published": published,
        "build": build,
        "title": titles,
        "url": {k: ARTICLE.format(locale=loc, id=news_id) for k, loc in LOCALES.items()},
        "heroes": heroes,
    }


async def _get_text(http: httpx.AsyncClient, url: str) -> str:
    r = await http.get(url, headers={"User-Agent": "Mozilla/5.0 (hpgg.win collector)"})
    r.raise_for_status()
    return r.text


async def collect_patchnotes(
    http: httpx.AsyncClient,
    patches_payload: dict[str, Any],
    heroes: dict[str, Any],
    *,
    existing: dict[str, Any] | None,
    now: datetime,
    limit: int = NOTE_LIMIT,
) -> dict[str, Any]:
    """The newest `limit` live/balance notes. Known notes are kept as they are (only a missing
    build is filled in); new ones are fetched in Korean and English and parsed."""
    lists = {
        k: _items(json.loads(await _get_text(http, NEWS.format(locale=loc))))
        for k, loc in LOCALES.items()
    }
    ko_titles = {str(p["newsId"]): str(p.get("title", "")) for p in lists["ko"]}
    wanted = [p for p in lists["en"] if is_patch_note(str(p.get("title", "")))][:limit]
    same_parser = (existing or {}).get("parser") == PARSER_VERSION
    known = {n["id"]: n for n in (existing or {}).get("notes", [])} if same_parser else {}
    keys = _hero_keys(heroes)
    notes = []
    for p in wanted:
        news_id = str(p["newsId"])
        published = str(p.get("lastUpdated", ""))
        when = _when(published)
        build = build_for(when, patches_payload) if when else None
        if news_id in known:
            note = dict(known[news_id])
            note["build"] = note.get("build") or build
            notes.append(note)
            continue
        parsed = {
            k: parse_balance(await _get_text(http, ARTICLE.format(locale=loc, id=news_id)), loc)
            for k, loc in LOCALES.items()
        }
        titles = {"ko": ko_titles.get(news_id, ""), "en": str(p.get("title", ""))}
        notes.append(_record(news_id, published, titles, parsed, keys, build))
        log.info("patchnotes.note", note=news_id, heroes=len(notes[-1]["heroes"]), build=build)
    return {
        "parser": PARSER_VERSION,
        "fetched_at": now.isoformat().replace("+00:00", "Z"),
        "notes": notes,
    }
