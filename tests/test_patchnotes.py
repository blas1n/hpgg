"""Official patch notes → per-hero changes with a direction (#62)."""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
import respx

from collector.patchnotes import (
    NEWS,
    PARSER_VERSION,
    HeroEntry,
    build_for,
    collect_patchnotes,
    direction,
    is_patch_note,
    parse_balance,
    verdict,
)

FIX = Path(__file__).parent / "fixtures" / "patchnotes"
# 2026-09-29 live, 2026-07-21 live, 2026-05-12 balance
NOTES = ["24303007", "24291432", "24276959"]
# older shapes: 2025-12-13 balance (no anchors, "to X, up from Y"), 2026-04-21 live (Arthas rework)
SHAPES = [*NOTES, "24252009", "24261475"]


def _html(note: str, locale: str) -> str:
    return (FIX / f"{note}_{locale}.html").read_text(encoding="utf-8")


def test_heroes_in_order_from_the_balance_section_only() -> None:
    ko = parse_balance(_html("24303007", "ko-kr"), "ko-kr")
    assert [h.name for h in ko] == [
        "아바투르",
        "알렉스트라자",
        "가로쉬",
        "말가니스",
        "키히라",
        "화이트메인",
        "이렐",
    ]
    en = parse_balance(_html("24303007", "en-us"), "en-us")
    assert [h.name for h in en] == [
        "Abathur",
        "Alexstrasza",
        "Garrosh",
        "Mal'Ganis",
        "Qhira",
        "Whitemane",
        "Yrel",
    ]


def test_groups_carry_section_level_and_ability() -> None:
    ko = {h.name: h for h in parse_balance(_html("24303007", "ko-kr"), "ko-kr")}
    aba = ko["아바투르"].groups
    assert (aba[0].section, aba[0].level, aba[0].ability) == ("talents", 13, "포격충 변종")
    assert [c.text for c in aba[0].changes] == ["생명력 감쇠 감소량이 50%에서 40%로 감소했습니다."]
    alex = ko["알렉스트라자"].groups
    assert (alex[0].section, alex[0].level, alex[0].ability) == ("base", None, None)
    assert alex[0].changes[0].text == "생명력이 1,698에서 1,780으로 증가했습니다."
    mal = ko["말가니스"].groups
    assert (mal[0].section, mal[0].ability) == ("base", "밤의 질주 [E]")


def _lines(entries: list[HeroEntry]) -> list[str]:
    return [c.text for h in entries for g in h.groups for c in g.changes]


@pytest.mark.parametrize("locale", ["en-us", "ko-kr"])
def test_struck_text_is_a_retracted_change_not_part_of_the_line(locale: str) -> None:
    # 2026-04-21: Blizzard strikes a retracted line whole, and an old value inline ("<s>35</s> 40")
    lines = _lines(parse_balance(_html("24261475", locale), locale))
    struck = {
        "en-us": ["Dwarf Toss cooldown increased by 2 seconds.", "No longer provides 25 Armor"],
        "ko-kr": [
            "드워프 도약의 재사용 대기시간이 2초 증가",
            "방어력을 3초 동안 25 증가시키지 않습니다",
        ],
    }[locale]
    for gone in struck:
        assert not any(gone in line for line in lines), gone
    inline = {
        "en-us": "Keg Smash energy cost increased to 40 from 30.",
        "ko-kr": "술통 부수기의 기력 소모량이 30에서 40으로 증가했습니다.",
    }[locale]
    assert inline in lines
    assert direction(inline, locale) == "down"
    assert not any(re.search(r"\b35 40\b|\b75% 100%|\b3\.5% 3%", line) for line in lines)


def test_a_balance_section_without_anchors_ends_at_the_next_heading() -> None:
    ko = parse_balance(_html("24252009", "ko-kr"), "ko-kr")
    assert [h.name for h in ko] == [
        "케리건",
        "스랄",
        "폴스타트",
        "실바나스",
        "굴단",
    ]  # not the maps


@pytest.mark.parametrize("note", SHAPES)
def test_korean_and_english_have_the_same_shape(note: str) -> None:
    ko = parse_balance(_html(note, "ko-kr"), "ko-kr")
    en = parse_balance(_html(note, "en-us"), "en-us")
    assert len(ko) == len(en) > 0
    for k, e in zip(ko, en, strict=True):
        assert [(g.section, g.level, len(g.changes)) for g in k.groups] == [
            (g.section, g.level, len(g.changes)) for g in e.groups
        ], k.name


@pytest.mark.parametrize("note", SHAPES)
def test_korean_and_english_never_contradict(note: str) -> None:
    """Two independent readings of Blizzard's two texts. ▲ against ▼ is a rule bug; one reading
    that cannot tell (a new talent's description reads like a change in Korean) is not — the
    record keeps such a line neutral (test_a_line_read_one_way_only_is_recorded_neutral)."""
    ko = parse_balance(_html(note, "ko-kr"), "ko-kr")
    en = parse_balance(_html(note, "en-us"), "en-us")
    for k, e in zip(ko, en, strict=True):
        for kg, eg in zip(k.groups, e.groups, strict=True):
            for kc, ec in zip(kg.changes, eg.changes, strict=True):
                assert {kc.direction, ec.direction} != {"up", "down"}, (k.name, kc.text, ec.text)


@pytest.mark.parametrize(
    ("text", "locale", "expected"),
    [
        ("생명력이 1,698에서 1,780으로 증가했습니다.", "ko-kr", "up"),
        ("Health increased from 1698 to 1780.", "en-us", "up"),
        ("Health reduced from 350 to 225.", "en-us", "down"),
        # lower is better: cooldown, mana cost, cast time, requirements
        ("재사용 대기시간이 60초에서 75초로 증가했습니다.", "ko-kr", "down"),
        ("Cooldown increased from 60 to 75 seconds.", "en-us", "down"),
        ("Cooldown increased 45 to 60 seconds.", "en-us", "down"),
        ("Cooldown decreased from 4 to 2.5 seconds.", "en-us", "up"),
        ("시전 시간이 0.75초에서 0.625초로 감소했습니다.", "ko-kr", "up"),
        ("퀘스트 요구 수치가 50/200에서 40/160으로 감소했습니다.", "ko-kr", "up"),
        ("Quest requirement reduced from 40 to 20 stacks.", "en-us", "up"),
        (
            "Base Mana cost increased from 40 to 45. Mana cost increase per use is unchanged.",
            "en-us",
            "down",
        ),
        # a reduction the hero applies: more is better, whatever it reduces
        ("Cooldown reduction per hit reduced from 1.5 to 1 second.", "en-us", "down"),
        ("Armor reduction increased from 10 to 15.", "en-us", "up"),
        ("방어력 감소량이 -35에서 -25로 감소했습니다.", "ko-kr", "down"),
        ("Stun duration reduced from 0.75 seconds to 0.6 seconds.", "en-us", "down"),
        # not a plain up/down: neutral
        ("Moved from Level 16 to Level 1.", "en-us", "neutral"),
        ("Damage adjusted from 285 on impact to 440 damage over 5 seconds.", "en-us", "neutral"),
        (
            "Healing duration increased from 3 to 4 seconds. Total healing is unchanged.",
            "en-us",
            "neutral",
        ),
        (
            "치유 지속시간이 3초에서 4초로 증가했습니다. 총 치유량은 그대로 유지됩니다.",
            "ko-kr",
            "neutral",
        ),
        (
            "Molten Core's Abilities range reduced from 35 to 20, but now grows from 20 to 35.",
            "en-us",
            "neutral",
        ),
        ("Now deals 75% reduced damage to Structures.", "en-us", "neutral"),
        ("Delay between hits significantly increased.", "en-us", "neutral"),
        # new value first (2025-12 notes)
        ("Baseline quest requirements increased to 85/150, up from 75/125.", "en-us", "down"),
        ("Cooldown reduction increased to .75 seconds, up from .6 seconds.", "en-us", "up"),
        ("기본 퀘스트 완료 조건이 75/125에서 85/150으로 증가했습니다.", "ko-kr", "down"),
        # a change by an amount
        ("사거리가 1 증가했습니다.", "ko-kr", "up"),
        ("공격력이 10% 감소했습니다.", "ko-kr", "down"),
        ("Dwarf Toss cooldown increased by 2 seconds.", "en-us", "down"),
        ("Now has a 1 second cooldown between uses, down from 2 seconds.", "en-us", "up"),
        ("Keg Smash energy cost increased to 35 40 from 30.", "en-us", "down"),
        # "up to 40%" is a cap, not a change
        (
            "Deals 36 damage per second to nearby enemies and Slow their Movement Speed by 10%"
            " per second, up to 40%.",
            "en-us",
            "neutral",
        ),
        (
            "Heal duration increased from 3 seconds to 4 seconds. Total healing remains the same.",
            "en-us",
            "neutral",
        ),
        ("중첩 생산 간격이 6초당 1번에서 5초당 1번으로 감소했습니다.", "ko-kr", "neutral"),
        ("일반 공격으로 감소하는 재사용 대기시간이 1초에서 1.5초로 증가했습니다.", "ko-kr", "up"),
    ],
)
def test_direction(text: str, locale: str, expected: str) -> None:
    assert direction(text, locale) == expected


def test_verdict_buff_nerf_or_mixed() -> None:
    assert verdict(["up", "up"]) == "buff"
    assert verdict(["down"]) == "nerf"
    assert verdict(["up", "down"]) == "mixed"
    assert verdict(["up", "neutral"]) == "mixed"  # a line we cannot read is not evidence of a buff
    assert verdict(["neutral"]) == "mixed"


# --- collection: list → new notes → one record per note ------------------------------------------

HEROES = json.loads((Path(__file__).parents[1] / "data" / "heroes_ko.json").read_text("utf-8"))
PATCHES = {
    "patches": [
        {"game_version": "2.55.17.97605", "date_added": "2026-07-21T15:02:00.000000Z"},
        {"game_version": "2.55.17.97650", "date_added": "2026-07-24T13:39:29.000000Z"},
        {"game_version": "2.57.0.98285", "date_added": "2026-09-29T14:10:00.000000Z"},
        {"game_version": "2.57.0.98304", "date_added": "2026-09-29T23:13:00.000000Z"},
    ]
}


def test_only_live_and_balance_notes_count() -> None:
    assert is_patch_note("Heroes of the Storm Live Patch Notes - September 28, 2026")
    assert is_patch_note("Heroes of the Storm Balance Patch Notes — February 19, 2026")
    assert not is_patch_note("Heroes of the Storm PTR Patch Notes - September 14, 2026")
    assert not is_patch_note("Xal'atath joins Heroes of the Storm!")


def test_a_note_belongs_to_the_first_build_listed_around_it() -> None:
    at = lambda s: datetime.fromisoformat(s)  # noqa: E731
    assert build_for(at("2026-09-28T19:35:00+00:00"), PATCHES) == "2.57.0.98285"
    assert build_for(at("2026-07-20T17:35:15+00:00"), PATCHES) == "2.55.17.97605"
    assert build_for(at("2026-05-11T17:00:00+00:00"), PATCHES) is None  # no build listed near it


def _mock_blizzard() -> None:
    for loc in ("ko-kr", "en-us"):
        respx.get(NEWS.format(locale=loc)).mock(
            return_value=httpx.Response(200, text=(FIX / f"list_{loc}.json").read_text("utf-8"))
        )
        for note in NOTES:
            respx.get(f"https://news.blizzard.com/{loc}/article/{note}/").mock(
                return_value=httpx.Response(200, text=_html(note, loc))
            )


@respx.mock
async def test_collects_each_note_once_in_both_languages_keyed_by_hero() -> None:
    _mock_blizzard()
    now = datetime(2026, 9, 30, tzinfo=UTC)
    async with httpx.AsyncClient() as http:
        out = await collect_patchnotes(http, PATCHES, HEROES, existing=None, now=now, limit=3)
    notes = out["notes"]
    assert [n["id"] for n in notes] == [
        "24303007",
        "24291432",
        "24276959",
    ]  # newest first, PTR skipped
    n = notes[0]
    assert n["build"] == "2.57.0.98285"
    assert n["title"]["ko"].startswith("히어로즈 오브 더 스톰 라이브 패치 노트")
    assert n["url"]["en"] == "https://news.blizzard.com/en-us/article/24303007/"
    qhira = n["heroes"]["Qhira"]
    assert qhira["verdict"] == "mixed"
    first = qhira["groups"][0]
    assert first["section"] == "base" and first["ability"] == {
        "ko": "피의 분노 [W]",
        "en": "Blood Rage [W]",
    }
    assert first["changes"][0]["direction"] == "down"
    assert first["changes"][0]["ko"].startswith("중첩당 추가 공격력")
    assert first["changes"][0]["en"]
    assert notes[2]["heroes"]["Mal'Ganis"]  # English name with an apostrophe maps too
    assert set(n["heroes"]) <= {h["name"] for h in HEROES["heroes"]}


@respx.mock
async def test_known_notes_are_not_fetched_again() -> None:
    _mock_blizzard()
    now = datetime(2026, 9, 30, tzinfo=UTC)
    async with httpx.AsyncClient() as http:
        first = await collect_patchnotes(http, PATCHES, HEROES, existing=None, now=now, limit=3)
        calls = respx.calls.call_count
        again = await collect_patchnotes(http, PATCHES, HEROES, existing=first, now=now, limit=3)
    assert respx.calls.call_count - calls == 2  # the two lists only
    assert again["notes"] == first["notes"]


@respx.mock
async def test_a_known_note_without_a_build_gets_one_when_the_build_appears() -> None:
    _mock_blizzard()
    now = datetime(2026, 9, 30, tzinfo=UTC)
    early = {"patches": PATCHES["patches"][:2]}  # 2.57 not listed yet
    async with httpx.AsyncClient() as http:
        first = await collect_patchnotes(http, early, HEROES, existing=None, now=now, limit=1)
        assert first["notes"][0]["build"] is None
        later = await collect_patchnotes(http, PATCHES, HEROES, existing=first, now=now, limit=1)
    assert later["notes"][0]["build"] == "2.57.0.98285"


@respx.mock
async def test_a_line_read_one_way_only_is_recorded_neutral() -> None:
    _mock_blizzard()
    async with httpx.AsyncClient() as http:
        out = await collect_patchnotes(
            http, PATCHES, HEROES, existing=None, now=datetime(2026, 9, 30, tzinfo=UTC), limit=2
        )
    alex = out["notes"][1]["heroes"]["Alexstrasza"]["groups"]
    line = next(
        c for g in alex for c in g["changes"] if c["en"] and c["en"].startswith("For each allied")
    )
    assert direction(line["ko"], "ko-kr") == "up" and direction(line["en"], "en-us") == "neutral"
    assert line["direction"] == "neutral"


@respx.mock
async def test_a_new_parser_version_reparses_every_note() -> None:
    _mock_blizzard()
    now = datetime(2026, 9, 30, tzinfo=UTC)
    async with httpx.AsyncClient() as http:
        first = await collect_patchnotes(http, PATCHES, HEROES, existing=None, now=now, limit=1)
        assert first["parser"] == PARSER_VERSION
        stale = {
            **first,
            "parser": PARSER_VERSION - 1,
            "notes": [{**first["notes"][0], "heroes": {}}],
        }
        again = await collect_patchnotes(http, PATCHES, HEROES, existing=stale, now=now, limit=1)
    assert again["notes"][0]["heroes"] == first["notes"][0]["heroes"]
