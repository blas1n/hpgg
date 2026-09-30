"""Unannounced hotfixes (#62): the numbers that changed between two builds' hero XML."""

from __future__ import annotations

import gzip
import json
from pathlib import Path

import pytest

from collector.hotfixes import (
    HOTFIX_PARSER,
    TalentIndex,
    hero_changes,
    hotfix_record,
    numeric_changes,
    save_record,
)

FIX = Path(__file__).parent / "fixtures" / "hotfix"


def _xml(build: str, name: str) -> str:
    return gzip.decompress((FIX / f"{build}_{name}data.xml.gz").read_bytes()).decode("utf-8")


def _pairs(changes: list) -> set[tuple[str, str, str]]:
    return {(c.entry, c.old, c.new) for c in changes}


def test_a_changed_talent_value_is_read_old_to_new() -> None:
    # 2.55.17.97650: A Touch of Honey slow -30% → -20%, on both slows it modifies
    got = numeric_changes(_xml("97605", "chen"), _xml("97650", "chen"))
    assert _pairs(got) == {("ChenMasteryKegSmashATouchOfHoney", "-0.3", "-0.2")}
    assert len(got) == 2


def test_every_changed_number_of_an_entry_is_read() -> None:
    got = numeric_changes(_xml("97605", "yrel"), _xml("97650", "yrel"))
    assert _pairs(got) == {
        ("YrelVindicationLightOfKaraborHealingAccumulator", "0.45", "0.4"),
        ("YrelVindicationLightOfKaraborHealingAccumulator", "0.9", "0.8"),
    }


def test_a_number_moved_into_a_const_of_the_same_value_is_no_change() -> None:
    # Cho'gall 97650: cooldowns 3 and 6 became $consts holding 3 and 6
    got = numeric_changes(_xml("97605", "chogall"), _xml("97650", "chogall"))
    assert not any(c.entry in {"GallShadowflame", "GallDreadOrb"} for c in got)
    assert all(c.old != c.new for c in got)


def test_rewired_effects_without_a_number_are_no_change() -> None:
    # Nazeebo 97650: effect arrays switched to another effect, no number changed
    assert numeric_changes(_xml("97605", "witchdoctor"), _xml("97650", "witchdoctor")) == []


def test_numbers_inside_indexed_arrays_are_compared_by_index() -> None:
    got = numeric_changes(_xml("97605", "chromie"), _xml("97650", "chromie"))
    assert {
        ("ChromieTimeTrapChronicConditionsIncreasedMovementSpeed", "0.2", "0.25"),
        ("ChromieTimeTrapChronicConditionsSlow", "-0.2", "-0.25"),
        ("ChromieSandEchoWeaponDamage", "-0.55", "-0.5"),
    } <= _pairs(got)


INDEX = TalentIndex(
    {
        "chen": {
            "ChenMasteryKegSmashATouchOfHoney": {"ko": "꿀 바르기", "en": "A Touch of Honey"},
            "ChenAccumulatingFlame": {"ko": "커져가는 불길", "en": "Accumulating Flame"},
        },
        "chromie": {
            "ChromieTimeTrapChronicConditions": {"ko": "만성적인 현상", "en": "Chronic Conditions"},
            "ChromieSandBlastOnceAgainTheFirstTime": {
                "ko": "다시 처음으로",
                "en": "Once Again the First Time",
            },
            "ChromieSandBlastMysticalMastery": {"ko": "신비한 숙련", "en": "Mystical Mastery"},
        },
        "yrel": {
            "YrelVindicationLightOfKarabor": {"ko": "카라보르의 빛", "en": "Light of Karabor"},
            "YrelSacredGround": {"ko": "신성한 대지", "en": "Sacred Ground"},
        },
    },
    {"chen": "Chen", "chromie": "Chromie", "yrel": "Yrel"},
)


def test_a_change_belongs_to_the_talent_its_entry_is_named_after() -> None:
    got = hero_changes(
        [
            (_xml("97605", "chen"), _xml("97650", "chen")),
            (_xml("97605", "yrel"), _xml("97650", "yrel")),
        ],
        INDEX,
    )
    assert got["Chen"] == [
        {
            "talent": "ChenMasteryKegSmashATouchOfHoney",
            "ko": "꿀 바르기",
            "en": "A Touch of Honey",
            "changes": [{"old": "-0.3", "new": "-0.2"}],  # the same pair once
        }
    ]
    assert got["Yrel"][0]["talent"] == "YrelVindicationLightOfKarabor"
    assert got["Yrel"][0]["changes"] == [
        {"old": "0.45", "new": "0.4"},
        {"old": "0.9", "new": "0.8"},
    ]


def test_a_change_on_a_shared_effect_belongs_to_the_talent_its_validator_names() -> None:
    # ChromieSandEchoWeaponDamage is the ability; the modifier is gated on the talent's quest
    got = hero_changes([(_xml("97605", "chromie"), _xml("97650", "chromie"))], INDEX)
    by_talent = {t["talent"]: t["changes"] for t in got["Chromie"]}
    assert by_talent["ChromieSandBlastOnceAgainTheFirstTime"] == [{"old": "-0.55", "new": "-0.5"}]
    assert by_talent["ChromieTimeTrapChronicConditions"] == [
        {"old": "0.2", "new": "0.25"},
        {"old": "-0.2", "new": "-0.25"},
    ]


def test_a_change_no_talent_claims_is_left_out() -> None:
    # no internal id ever reaches the page: nothing in the index names these entries
    got = hero_changes([(_xml("97605", "chogall"), _xml("97650", "chogall"))], INDEX)
    assert got == {}


def test_the_record_carries_both_builds_and_when_the_new_one_appeared() -> None:
    rec = hotfix_record(
        build="2.55.17.97650",
        previous="2.55.17.97605",
        first_seen="2026-07-24T17:21:04Z",
        files=[(_xml("97605", "chen"), _xml("97650", "chen"))],
        index=INDEX,
    )
    assert rec["build"] == "2.55.17.97650"
    assert rec["previous"] == "2.55.17.97605"
    assert rec["first_seen"] == "2026-07-24T17:21:04Z"
    assert rec["parser"] == HOTFIX_PARSER
    assert list(rec["heroes"]) == ["Chen"]


@pytest.mark.parametrize(
    ("old", "new"),
    [
        ('<Catalog><CTalent id="A"><Value value="1"/></CTalent></Catalog>', None),
        ('<Catalog><CTalent id="A"><Value value="x"/></CTalent></Catalog>', None),
    ],
)
def test_identical_or_non_numeric_entries_are_no_change(old: str, new: str | None) -> None:
    assert numeric_changes(old, new or old) == []


def test_a_const_change_reaches_every_entry_that_reads_it() -> None:
    old = (
        '<Catalog><const id="$Cd" value="3"/>'
        '<CAbil id="Q"><Cooldown TimeUse="$Cd"/></CAbil></Catalog>'
    )
    new = old.replace('value="3"', 'value="2.5"')
    assert _pairs(numeric_changes(old, new)) == {("Q", "3", "2.5")}


def test_a_talent_named_inside_an_ability_entry_claims_it() -> None:
    # Cho'gall 97650: GallShadowflameDoubleTroubleTalentCompletionModifyPlayer 0.5 → 1
    # (Double Trouble's completion cooldown reduction; the 1.0 override moved into the parent)
    index = TalentIndex(
        {
            "gall": {
                "GallDoubleTrouble": {"ko": "이중 난관", "en": "Double Trouble"},
                "GallRunicBlast": {"ko": "룬 폭발", "en": "Runic Blast"},
            }
        },
        {"gall": "Gall"},
    )
    got = hero_changes([(_xml("97605", "chogall"), _xml("97650", "chogall"))], index)
    assert got == {
        "Gall": [
            {
                "talent": "GallDoubleTrouble",
                "ko": "이중 난관",
                "en": "Double Trouble",
                "changes": [{"old": "0.5", "new": "1"}],
            }
        ]
    }


def test_a_generic_talent_does_not_hide_the_heros_prefix() -> None:
    # most heroes also have Generic… talents: the prefix is the heroes' own first word
    index = TalentIndex(
        {
            "chromie": {
                "ChromieSandBlastOnceAgainTheFirstTime": {"ko": "다시 처음으로", "en": "x"},
                "ChromieTimeTrapChronicConditions": {"ko": "만성적인 현상", "en": "y"},
                "GenericTalentFollowThrough": {"ko": "계속되는 공격", "en": "z"},
            }
        },
        {"chromie": "Chromie"},
    )
    got = hero_changes([(_xml("97650", "chromie"), _xml("97771", "chromie"))], index)
    assert [t["talent"] for t in got["Chromie"]] == ["ChromieSandBlastOnceAgainTheFirstTime"]


def test_records_are_kept_newest_first_and_a_rerun_replaces_its_build(tmp_path: Path) -> None:
    path = tmp_path / "hotfixes.json"

    def rec(build: str, seen: str, heroes: dict | None = None) -> dict:
        return {
            "build": build,
            "previous": "p",
            "first_seen": seen,
            "parser": 1,
            "heroes": heroes or {},
        }

    save_record(path, rec("2.55.17.97650", "2026-07-24T17:21:04Z"))
    save_record(path, rec("2.55.17.97771", "2026-08-12T18:13:03Z"))
    save_record(path, rec("2.55.17.97650", "2026-07-24T17:21:04Z", {"Chen": []}))
    data = json.loads(path.read_text("utf-8"))
    assert [r["build"] for r in data["builds"]] == ["2.55.17.97771", "2.55.17.97650"]
    assert data["builds"][1]["heroes"] == {"Chen": []}
