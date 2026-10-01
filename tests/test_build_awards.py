"""End-of-match awards: names from the game strings, icons from heroes-images, HP's ids mapped."""

from __future__ import annotations

import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "build_awards", Path(__file__).resolve().parents[1] / "tools" / "build_awards.py"
)
bw = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
spec.loader.exec_module(bw)  # type: ignore[union-attr]
award_table, hp_award_keys = bw.award_table, bw.hp_award_keys

AWD = {
    "MVP": {"mvpScreenIcon": "storm_ui_mvp_mvp_%color%.png"},
    "MostDamageTaken": {"mvpScreenIcon": "storm_ui_mvp_bulwark_%color%.png"},
    "MostVengeancesPerformed": {"mvpScreenIcon": "storm_ui_mvp_avenger_%color%.png"},
    "MostXPContribution": {"mvpScreenIcon": "storm_ui_mvp_experienced_%color%.png"},
}
KO = {
    "gamestrings": {
        "award": {
            "name": {
                "MVP": "MVP",
                "MostDamageTaken": "최후의 보루",
                "MostVengeancesPerformed": "복수자",
                "MostXPContribution": "숙련자",
            }
        }
    }
}
EN = {
    "gamestrings": {
        "award": {
            "name": {
                "MVP": "MVP",
                "MostDamageTaken": "Bulwark",
                "MostVengeancesPerformed": "Avenger",
                "MostXPContribution": "Experienced",
            }
        }
    }
}


def test_award_table_names_and_icons_from_the_game() -> None:
    t = award_table(AWD, KO, EN)
    assert t["MostDamageTaken"] == {
        "ko": "최후의 보루",
        "en": "Bulwark",
        "icon": "storm_ui_mvp_bulwark_blue.png",
    }
    assert t["MVP"]["icon"] == "storm_ui_mvp_mvp_gold.png"  # MVP wears gold in the game


def test_hp_ids_map_by_title_first_then_icon() -> None:
    seen = {
        # HP sends the Avenger icon with Bulwark (recorded 2026-10-01): the title decides
        6: ("Bulwark", "storm_ui_mvp_avenger"),
        24: ("Avenger", "storm_ui_mvp_avenger"),
        # HP's title differs from the game's name: the icon decides
        3: ("Most XP Contribution", "storm_ui_mvp_experienced"),
        1: ("MVP", "storm_ui_mvp_mvp"),
        99: ("Unknown Thing", "storm_ui_mvp_nothing"),
    }
    keys = hp_award_keys(seen, AWD, EN)
    assert keys == {
        "1": "MVP",
        "3": "MostXPContribution",
        "6": "MostDamageTaken",
        "24": "MostVengeancesPerformed",
    }
