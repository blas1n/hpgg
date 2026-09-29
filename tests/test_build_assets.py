from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

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


ROLES = [{"name": "Support", "ko": "지원가"}, {"name": "Ranged Assassin", "ko": "원거리 암살자"}]


def test_stats_hero_names_are_every_hero_in_the_latest_stats_and_builds(tmp_path: Path) -> None:
    latest = tmp_path / "latest"
    latest.mkdir()
    (latest / "qm.json").write_text(json.dumps({"rows": [{"hero": "Abathur", "map": "all"}]}))
    (latest / "sl_low.json").write_text(json.dumps({"rows": [{"hero": "Li-Ming", "map": "x"}]}))
    (latest / "builds.json").write_text(json.dumps({"heroes": {"Xal'atath": []}}))
    (latest / "meta.json").write_text(json.dumps({"modes": {}}))
    assert ba.stats_hero_names(tmp_path) == {"Abathur", "Li-Ming", "Xal'atath"}


def test_hero_rows_come_from_game_data_and_skip_heroes_it_does_not_have_yet() -> None:
    kokr = {
        "gamestrings": {
            **KOKR["gamestrings"],
            "unit": {
                **KOKR["gamestrings"]["unit"],
                "expandedrole": {"Abathur": "지원가", "Wizard": "원거리 암살자"},
            },
        }
    }
    # #6: Xal'atath is in the stats of patch 2.57 but not in heroes-data 2.55.16 → left out, named
    rows, missing = ba.hero_rows(HERODATA, kokr, {"Li-Ming", "Xal'atath", "Abathur"}, ROLES)
    assert missing == ["Xal'atath"]
    assert rows == [
        {
            "name": "Abathur",
            "slug": "abathur",
            "ko": "아바투르",
            "role": "Support",
            "role_ko": "지원가",
            "short_name": "abathur",
            "portrait": "img/heroes/abathur.png",
        },
        {
            "name": "Li-Ming",
            "slug": "li-ming",
            "ko": "리밍",
            "role": "Ranged Assassin",
            "role_ko": "원거리 암살자",
            "short_name": "liming",
            "portrait": "img/heroes/li-ming.png",
        },
    ]


def test_portrait_file_is_the_draft_portrait_of_the_game_data() -> None:
    hero = {"portraits": {"draftScreen": "storm_ui_glues_draft_portrait_xalatath.png"}}
    assert ba.portrait_file(hero) == "storm_ui_glues_draft_portrait_xalatath.png"
    assert ba.portrait_file({}) is None


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


def test_main_adds_a_new_hero_once_the_game_data_build_has_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """#6 end to end: Xal'atath is in data/latest/ but not in heroes_ko.json; a rerun with a
    heroes-data build that has her adds her row and talent file (no downloads: --skip-icons)."""
    data, cache = tmp_path / "data", tmp_path / "cache"
    (data / "latest").mkdir(parents=True)
    cache.mkdir()
    table = {
        "roles": ROLES,
        "heroes": [{"name": "Abathur"}],
        "source": {"names": "old", "portraits": "heroes-images"},
    }
    (data / "heroes_ko.json").write_text(json.dumps(table))
    rows = [{"hero": "Abathur", "map": "all"}, {"hero": "Xal'atath", "map": "all"}]
    (data / "latest" / "qm.json").write_text(json.dumps({"rows": rows}))
    herodata = {
        "Abathur": HERODATA["Abathur"],
        "Xalatath": {
            "hyperlinkId": "Xalatath",
            "talents": {"level10": [{"nameId": "XalatathVoidEruption", "icon": "x.png"}]},
        },
    }
    unit = {
        "name": {"Abathur": "아바투르", "Xalatath": "잘아타스"},
        "expandedrole": {"Abathur": "지원가", "Xalatath": "원거리 암살자"},
    }
    names = {"XalatathVoidEruption|B|Heroic|False": "공허 폭발"}
    kokr = {"gamestrings": {"unit": unit, "abiltalent": {"name": names}}}
    (cache / "herodata_99999.json").write_text(json.dumps(herodata))
    (cache / "kokr_99999.json").write_text(json.dumps(kokr))
    (cache / "enus_99999.json").write_text(json.dumps(ENUS))
    argv = ["build_assets", "--build", "2.57.0.99999", "--data", str(data), "--cache", str(cache)]
    monkeypatch.setattr("sys.argv", [*argv, "--skip-icons"])
    ba.main()
    out = json.loads((data / "heroes_ko.json").read_text())
    assert [h["name"] for h in out["heroes"]] == ["Abathur", "Xal'atath"]
    assert out["heroes"][1] == {
        "name": "Xal'atath",
        "slug": "xal-atath",
        "ko": "잘아타스",
        "en": "Xal'atath",
        "role": "Ranged Assassin",
        "role_ko": "원거리 암살자",
        "short_name": "xalatath",
        "portrait": "img/heroes/xal-atath.png",
    }
    assert [{k: r[k] for k in ("name", "ko")} for r in out["roles"]] == ROLES
    assert out["source"]["portraits"] == "heroes-images"
    assert "99999" in out["source"]["names"]
    talents = json.loads((data / "talents" / "xal-atath.json").read_text())["talents"]
    assert talents == {
        "XalatathVoidEruption": {"ko": "공허 폭발", "icon": "x.png", "en": "XalatathVoidEruption"}
    }  # no enus string and no English name in the game data → the nameId


ENUS = {
    "gamestrings": {
        "unit": {
            "name": {"Abathur": "Abathur", "Wizard": "Li-Ming", "Xalatath": "Xal'atath"},
            "expandedrole": {
                "Abathur": "Support",
                "Wizard": "Ranged Assassin",
                "Xalatath": "Ranged Assassin",
            },
        },
        "abiltalent": {
            "name": {
                "AbathurPressureConvergence|X|Passive|True": "Pressure Convergence",
                "WizardAetherWalker|Y|Q|False": "Aether Walker",
            },
            "full": {
                "AbathurPressureConvergence|X|Passive|True": (
                    'Increases range by <c val="x">20%</c>.'
                ),
                "WizardAetherWalker|Y|Q|False": 'Deals <c val="x">100~~0.04~~</c> damage.',
            },
            "cooldown": {"AbathurPressureConvergence|X|Passive|True": "Cooldown: 10 seconds"},
        },
    }
}


def test_clean_desc_in_english_prints_the_per_level_scaling_in_english() -> None:
    raw = 'Deals <c val="x">108~~0.04~~</c> damage.<n/>Armor <s val="x" name="y">25</s>'
    assert ba.clean_desc(raw, "en") == "Deals {{108 (+4% per level)}} damage.\nArmor 25"
    assert ba.clean_desc('<c val="x">50~~0.025~~</c>', "en") == "{{50 (+2.5% per level)}}"
    # Korean stays exactly as before (the default)
    assert ba.clean_desc('<c val="x">50~~0.025~~</c>') == "{{50(레벨당 +2.5%)}}"


def test_role_names_pair_each_korean_role_with_its_english_game_name() -> None:
    roles = {"Abathur": "지원가", "Wizard": "원거리 암살자"}
    kokr = {"gamestrings": {"unit": {"expandedrole": roles}}}
    assert ba.role_names(kokr, ENUS) == {"지원가": "Support", "원거리 암살자": "Ranged Assassin"}


def test_hero_rows_carry_the_english_game_name_when_enus_is_given() -> None:
    kokr = {
        "gamestrings": {
            **KOKR["gamestrings"],
            "unit": {
                **KOKR["gamestrings"]["unit"],
                "expandedrole": {"Abathur": "지원가", "Wizard": "원거리 암살자"},
            },
        }
    }
    rows, _ = ba.hero_rows(HERODATA, kokr, {"Li-Ming", "Abathur"}, ROLES, ENUS)
    assert [r["en"] for r in rows] == ["Abathur", "Li-Ming"]
    # Korean fields and their order are unchanged; `en` follows `ko`
    keys = ["name", "slug", "ko", "en", "role", "role_ko", "short_name", "portrait"]
    assert list(rows[0]) == keys


def test_talent_files_carry_english_name_description_and_cooldown() -> None:
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
    files = ba.hero_talent_files(HERODATA, kokr, heroes, ENUS)
    assert files["abathur"] == {
        "AbathurPressureConvergence": {
            "ko": "압박 수렴",
            "icon": "a.png",
            "desc": "사거리 {{20%}} 증가",
            "cd": "재사용 대기시간: 10초",
            "en": "Pressure Convergence",
            "desc_en": "Increases range by {{20%}}.",
            "cd_en": "Cooldown: 10 seconds",
        }
    }
    assert files["li-ming"] == {
        "WizardAetherWalker": {
            "ko": "Aether Walker",
            "icon": "b.png",
            "en": "Aether Walker",
            "desc_en": "Deals {{100 (+4% per level)}} damage.",
        }
    }


def test_main_writes_english_names_next_to_the_korean_ones(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data, cache = tmp_path / "data", tmp_path / "cache"
    (data / "latest").mkdir(parents=True)
    cache.mkdir()
    table = {"roles": ROLES, "heroes": [{"name": "Abathur"}], "source": {"names": "old"}}
    (data / "heroes_ko.json").write_text(json.dumps(table))
    unit = {"name": {"Abathur": "아바투르"}, "expandedrole": {"Abathur": "지원가"}}
    kokr = {"gamestrings": {"unit": unit, "abiltalent": KOKR["gamestrings"]["abiltalent"]}}
    (cache / "herodata_99999.json").write_text(json.dumps({"Abathur": HERODATA["Abathur"]}))
    (cache / "kokr_99999.json").write_text(json.dumps(kokr))
    (cache / "enus_99999.json").write_text(json.dumps(ENUS))
    argv = ["build_assets", "--build", "2.57.0.99999", "--data", str(data), "--cache", str(cache)]
    monkeypatch.setattr("sys.argv", [*argv, "--skip-icons"])
    ba.main()
    out = json.loads((data / "heroes_ko.json").read_text())
    assert out["heroes"][0]["en"] == "Abathur"
    assert out["roles"] == [
        {"name": "Support", "ko": "지원가", "en": "Support"},
        {"name": "Ranged Assassin", "ko": "원거리 암살자", "en": "Ranged Assassin"},
    ]
    assert "enus" in out["source"]["names"]
    talents = json.loads((data / "talents" / "abathur.json").read_text())
    assert talents["talents"]["AbathurPressureConvergence"]["en"] == "Pressure Convergence"
    assert "enus" in talents["source"]


REPO_DATA = Path(__file__).parents[1] / "data"


def missing_talent_icons(data: Path) -> dict[str, list[str]]:
    """Talent file → icons it names that are not in data/img/talents/."""
    shipped = {p.name for p in (data / "img" / "talents").iterdir()}
    out: dict[str, list[str]] = {}
    for f in sorted((data / "talents").glob("*.json")):
        talents = json.loads(f.read_text(encoding="utf-8"))["talents"]
        gone = sorted({t["icon"] for t in talents.values() if t.get("icon")} - shipped)
        if gone:
            out[f.name] = gone
    return out


def test_every_talent_icon_named_in_the_talent_files_is_shipped() -> None:
    """A hero page shows the icon of every talent in its builds, and the builds change daily:
    an icon missing from data/img/talents/ is a 404 on the site (Illidan, 2026-09-29)."""
    assert len(list((REPO_DATA / "talents").glob("*.json"))) >= 90
    assert missing_talent_icons(REPO_DATA) == {}


def test_missing_talent_icons_reports_what_a_talent_file_names_but_the_folder_lacks(
    tmp_path: Path,
) -> None:
    """Control for the guard above: it can go red."""
    (tmp_path / "img" / "talents").mkdir(parents=True)
    (tmp_path / "talents").mkdir()
    (tmp_path / "img" / "talents" / "a.png").write_bytes(b"")
    talents = {"A": {"icon": "a.png"}, "B": {"icon": "b.png"}, "C": {"icon": ""}}
    (tmp_path / "talents" / "x.json").write_text(json.dumps({"talents": talents}))
    assert missing_talent_icons(tmp_path) == {"x.json": ["b.png"]}


def test_main_downloads_the_icon_of_every_talent_not_only_those_in_one_days_builds(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The builds change every day, so any talent can reach a hero page tomorrow: the generator
    fetches every talent's icon and has no option to narrow that to one day's builds (--icons
    did, which is how three Illidan icons went missing)."""
    data, cache = tmp_path / "data", tmp_path / "cache"
    (data / "latest").mkdir(parents=True)
    cache.mkdir()
    table = {"roles": ROLES, "heroes": [{"name": "Abathur"}, {"name": "Li-Ming"}], "source": {}}
    (data / "heroes_ko.json").write_text(json.dumps(table))
    unit = {
        "name": {"Abathur": "아바투르", "Wizard": "리밍"},
        "expandedrole": {"Abathur": "지원가", "Wizard": "원거리 암살자"},
    }
    kokr = {"gamestrings": {"unit": unit, "abiltalent": KOKR["gamestrings"]["abiltalent"]}}
    (cache / "herodata_99999.json").write_text(json.dumps(HERODATA))
    (cache / "kokr_99999.json").write_text(json.dumps(kokr))
    (cache / "enus_99999.json").write_text(json.dumps(ENUS))
    fetched: list[str] = []

    def fake_fetch(url: str, dest: Path) -> bool:
        fetched.append(url.rsplit("/", 1)[-1])
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"png")
        return True

    def fake_resize(src: Path, dst: Path, px: int) -> None:
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(src.read_bytes())

    monkeypatch.setattr(ba, "fetch", fake_fetch)
    monkeypatch.setattr(ba, "resize", fake_resize)
    argv = ["build_assets", "--build", "2.55.16.99999", "--data", str(data), "--cache", str(cache)]
    monkeypatch.setattr("sys.argv", argv)
    ba.main()
    assert {"a.png", "b.png"} <= set(fetched)
    assert missing_talent_icons(data) == {}
    monkeypatch.setattr("sys.argv", [*argv, "--icons", "builds.json"])
    with pytest.raises(SystemExit):
        ba.main()
