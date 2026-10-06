"""Names in a report are the game's own (owner 2026-10-06: "퀴라가 아니라 키히라" — a wrong name
costs the report its readers' trust). Every hero, ability and talent named in the English text
must appear in the Korean text under its official Korean name (data/heroes_ko.json,
data/talents/<slug>.json)."""

from __future__ import annotations

from pathlib import Path

from collector.name_check import name_mismatches

DATA = Path(__file__).parents[1] / "data"


def _analysis(ko: list[str], en: list[str]) -> dict:
    return {"title": {"ko": "", "en": ""}, "paragraphs": {"ko": ko, "en": en}}


def test_a_hero_named_in_english_must_carry_its_official_korean_name() -> None:
    a = _analysis(
        ["퀴라가 66.8%, 브라이트윙이 26.9%의 판에서 밴됐다."],
        ["Qhira is banned in 66.8% and Brightwing in 26.9% of games."],
    )
    got = {m["en"]: m["ko"] for m in name_mismatches(a, DATA)}
    assert got == {"Qhira": "키히라", "Brightwing": "빛나래"}


def test_correct_names_pass() -> None:
    a = _analysis(
        ["키히라가 66.8%, 빛나래가 26.9%의 판에서 밴됐다. 잘아타스의 공허 걸음과 고정 핵."],
        ["Qhira 66.8%, Brightwing 26.9%. Xal'atath's Void Step and Anchored Core."],
    )
    assert name_mismatches(a, DATA) == []


def test_abilities_and_talents_of_named_heroes_are_checked_too() -> None:
    a = _analysis(["잘아타스의 공허 발걸음."], ["Xal'atath's Void Step."])
    got = name_mismatches(a, DATA)
    assert {"en": "Void Step", "ko": "공허 걸음", "kind": "ability"} in got


def test_one_english_name_of_two_heroes_passes_with_either_korean_name() -> None:
    # Diablo's ability Overpower is 압도; Varian's talent Overpower is 제압
    a = _analysis(
        ["디아블로의 압도, 바리안은 순위가 올랐다."],
        ["Diablo's Overpower; Varian climbed."],
    )
    assert name_mismatches(a, DATA) == []
