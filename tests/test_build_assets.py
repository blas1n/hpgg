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


def test_clean_desc_turns_game_markup_into_text_with_highlight_markers() -> None:
    raw = (
        '대상에게 <c val="bfd4fd">108~~0.04~~</c>의 추가 피해를 줍니다.<n/><n/>'
        '<img path="@UI/StormTalentInTextArmorIcon" alignment="uppermiddle" color="BBBBBB"'
        ' width="20" height="22"/>'
        '방어력 <s val="bfd4fd" name="StandardTooltipDetails">25</s> 증가'
    )
    expected = "대상에게 {{108(레벨당 +4%)}}의 추가 피해를 줍니다.\n\n방어력 25 증가"
    assert ba.clean_desc(raw) == expected
    assert ba.clean_desc('<c val="x">50~~0.025~~</c>') == "{{50(레벨당 +2.5%)}}"


def test_clean_desc_picks_the_korean_particle_by_the_final_consonant() -> None:
    # 20 → 이십 (ㅂ) → 으로 ; 30 → 삼십 → 으로 ; 5 → 오 → 로 ; 속도 → 로 ; 1 → 일 (ㄹ) → 로
    rule = '<lang rule="jongsung">으로,로</lang>'
    assert ba.clean_desc(f'<c val="x">20</c>{rule} 감소') == "{{20}}으로 감소"
    assert ba.clean_desc(f"속도{rule} 증가") == "속도로 증가"
    assert ba.clean_desc(f'<c val="x">5</c>{rule}') == "{{5}}로"
    assert ba.clean_desc(f'<c val="x">1</c>{rule}') == "{{1}}로"
    assert ba.clean_desc(f'<c val="x">30%</c>{rule}') == "{{30%}}로"  # 퍼센트


def test_hero_talent_files_split_per_hero_slug_with_description_and_cooldown() -> None:
    kokr = {
        "gamestrings": {
            **KOKR["gamestrings"],
            "abiltalent": {
                "name": KOKR["gamestrings"]["abiltalent"]["name"],
                "full": {
                    "AbathurPressureConvergence|X|Passive|True": '사거리 <c val="x">20%</c> 증가'
                },
                "cooldown": {"AbathurPressureConvergence|X|Passive|True": "재사용 대기시간: 10초"},
            },
        }
    }
    heroes = [{"name": "Abathur", "slug": "abathur"}, {"name": "Li-Ming", "slug": "li-ming"}]
    files = ba.hero_talent_files(HERODATA, kokr, heroes)
    assert files["abathur"] == {
        "AbathurPressureConvergence": {
            "ko": "압박 수렴",
            "icon": "a.png",
            "desc": "사거리 {{20%}} 증가",
            "cd": "재사용 대기시간: 10초",
        }
    }
    # no Korean strings for Li-Ming's talent → English name, no description or cooldown keys
    assert files["li-ming"] == {"WizardAetherWalker": {"ko": "Aether Walker", "icon": "b.png"}}
