from __future__ import annotations

import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "build_assets", Path(__file__).parents[1] / "tools" / "build_assets.py"
)
ba = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
assert spec and spec.loader
spec.loader.exec_module(ba)

HERODATA = {
    "Abathur": {
        "hyperlinkId": "Abathur",
        "talents": {
            "level1": [
                {
                    "nameId": "AbathurPressureConvergence",
                    "name": "Pressure Convergence",
                    "icon": "a.png",
                }
            ]
        },
    },
    "Cho": {"hyperlinkId": "Chogall", "talents": {}},
    "LostVikings": {"hyperlinkId": "LostVikings", "talents": {}},
    "Wizard": {
        "hyperlinkId": "LiMing",
        "talents": {
            "level1": [{"nameId": "WizardAetherWalker", "name": "Aether Walker", "icon": "b.png"}]
        },
    },
}
KOKR = {
    "gamestrings": {
        "unit": {
            "name": {
                "Abathur": "아바투르",
                "Cho": "초",
                "LostVikings": "길 잃은 바이킹",
                "Wizard": "리밍",
            }
        },
        "abiltalent": {
            "name": {
                "AbathurPressureConvergence|X|Passive|True": "압박 수렴",
                "Other|Y|Q|False": "무관",
            }
        },
    }
}


def test_norm_and_slug_handle_hp_names() -> None:
    assert ba.norm("Anub'arak") == "anubarak"
    assert ba.norm("Lúcio") == "lucio"
    assert ba.norm("E.T.C.") == "etc"
    assert ba.slug("Kael'thas") == "kael-thas" and ba.slug("Lt. Morales") == "lt-morales"


def test_korean_hero_names_use_game_strings_including_manual_ids() -> None:
    out = ba.korean_hero_names(HERODATA, KOKR, ["Abathur", "Cho", "The Lost Vikings", "Li-Ming"])
    assert out == {
        "Abathur": "아바투르",
        "Cho": "초",
        "The Lost Vikings": "길 잃은 바이킹",
        "Li-Ming": "리밍",
    }


def test_talent_table_maps_name_id_to_korean_and_icon_with_english_fallback() -> None:
    t = ba.talent_table(HERODATA, KOKR)
    assert t["AbathurPressureConvergence"] == {"ko": "압박 수렴", "icon": "a.png"}
    assert t["WizardAetherWalker"] == {
        "ko": "Aether Walker",
        "icon": "b.png",
    }  # no ko string → English name
