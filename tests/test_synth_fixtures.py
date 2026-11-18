"""tools/synth_fixtures.py: test fixtures without Heroes Profile data (HP API terms §3/§9,
docs/SHUTDOWN-2026-11-28.md).

Every number HP measured is redrawn at random, keeping only its number of digits; counts that belong
together (wins/losses/games/win rate) are made consistent again; game facts (hero, map and talent
names and ids, patch versions, dates) stay; player identities (BattleTags, Blizzard ids, replay ids,
fingerprints) become fake ones.
"""

from __future__ import annotations

from typing import Any

from tools.synth_fixtures import Identities, synth


def _row(**kw: Any) -> dict[str, Any]:
    return {"hero": "Qhira", "map": "all", **kw}


def test_counts_are_redrawn_but_keep_their_digits() -> None:
    src = {"rows": [_row(wins=5839, losses=4569, games=10408, bans=12, pick=23.0)]}
    out = synth(src, seed="a")
    row = out["rows"][0]
    assert row["games"] != 10408 and 10_000 <= row["games"] < 100_000
    assert 10 <= row["bans"] < 100
    assert row["hero"] == "Qhira" and row["map"] == "all"


def test_wins_losses_games_and_win_rate_agree_after_redraw() -> None:
    src = {"rows": [_row(wins=5839, losses=4569, games=10408, win_rate=56.1, tier_win_rate=56.1)]}
    row = synth(src, seed="a")["rows"][0]
    assert row["wins"] + row["losses"] == row["games"]
    assert row["win_rate"] == round(row["wins"] / row["games"] * 100, 1)
    assert row["tier_win_rate"] == row["win_rate"]
    assert 35 <= row["win_rate"] <= 65


def test_win_rate_without_games_is_redrawn_as_a_plausible_rate() -> None:
    row = synth({"x": {"win_rate": 56.37, "games": 965}}, seed="a")["x"]
    assert 35 <= row["win_rate"] <= 65 and row["win_rate"] != 56.37


def test_game_facts_and_enumerations_are_kept() -> None:
    src = {
        "patch": "2.55.17.98025",
        "collected_at": "2026-09-28T00:20:00Z",
        "hero_id": 80,
        "map_id": 6,
        "region": 2,
        "talents": [{"level": 4, "name": "AbathurSlapathur", "talent_id": 409}],
        "league_tier": [1, 2],
    }
    assert synth(src, seed="a") == src


def test_same_seed_same_output_and_different_seed_differs() -> None:
    src = {"rows": [_row(wins=5839, losses=4569, games=10408)]}
    assert synth(src, seed="a") == synth(src, seed="a")
    assert synth(src, seed="a") != synth(src, seed="b")


def test_player_identities_become_fake_and_stay_consistent_across_files() -> None:
    ids = Identities()
    a = synth(
        {"battletag": "Somebody#1940", "blizz_id": 123456, "replayID": 55555555}, seed="a", ids=ids
    )
    b = synth(
        {"players": [{"battletag": "Somebody#1940"}], "replay_id": 55555555}, seed="b", ids=ids
    )
    assert a["battletag"] != "Somebody#1940" and "#" in a["battletag"]
    assert b["players"][0]["battletag"] == a["battletag"]
    assert a["blizz_id"] != 123456
    assert b["replay_id"] == a["replayID"] != 55555555
    assert ids.text("profile of Somebody#1940") == f"profile of {a['battletag']}"


def test_fingerprints_are_replaced() -> None:
    fp = "0a1b2c3d-4e5f-6789-abcd-ef0123456789"
    out = synth({"fingerprint": fp}, seed="a")
    assert out["fingerprint"] != fp and len(out["fingerprint"]) == len(fp)


def test_a_known_players_bare_name_is_replaced_too() -> None:
    ids = Identities()
    ids.tag("Example#2345")
    fake = ids.tag("Example#2345").split("#")[0]
    out = synth(
        {"battletag": "Example", "url": "/players/Example%232345", "hero": "Zenith"},
        seed="a",
        ids=ids,
    )
    assert out["battletag"] == fake
    assert out["url"] == f"/players/{fake}%23{ids.tag('Example#2345').split('#')[1]}"
    assert out["hero"] == "Zenith"  # only whole names of five or more characters


def test_recorded_http_status_codes_are_kept() -> None:
    src = {"status": 404, "headers": {"x-hp-quota-limit": "10000"}, "body": {"status": "pending"}}
    assert synth(src, seed="a") == src


def test_matchup_pairs_add_up_to_the_heros_own_record() -> None:
    src = {
        "hero": "Abathur",
        "games": 100,
        "wins": 50,
        "win_rate": 50.0,
        "ally": [{"hero": f"A{i}", "games": 100, "wins": 50, "win_rate": 50.0} for i in range(4)],
        "enemy": [{"hero": f"E{i}", "games": 100, "wins": 50, "win_rate": 50.0} for i in range(5)],
    }
    out = synth(src, seed="m")
    for side, n in (("ally", 4), ("enemy", 5)):
        pairs = out[side]
        assert sum(p["games"] for p in pairs) == n * out["games"]
        assert sum(p["wins"] for p in pairs) == n * out["wins"]
        for p in pairs:
            assert 0 <= p["wins"] <= p["games"]
            assert p["win_rate"] == round(p["wins"] / p["games"] * 100, 1)


def test_takedowns_are_kills_plus_assists() -> None:
    row = synth({"kills": 5, "assists": 12, "takedowns": 17, "deaths": 3}, seed="t")
    assert row["takedowns"] == row["kills"] + row["assists"]


def test_a_list_sorted_by_games_stays_sorted() -> None:
    src = {"heroes": [{"hero": h, "games": g} for h, g in (("A", 900), ("B", 500), ("C", 120))]}
    games = [r["games"] for r in synth(src, seed="s")["heroes"]]
    assert games == sorted(games, reverse=True)


def test_draft_order_map_ids_and_paging_are_kept() -> None:
    src = {
        "draft_order": [{"pick_number": i, "type": 1} for i in range(16)],
        "game_map": 7,
        "type_role_hero": 10000,
        "per_page": 3,
        "total": 3,
        "current_page": 1,
    }
    assert synth(src, seed="d") == src


def test_each_win_rate_follows_its_own_wins_and_losses() -> None:
    src = {
        "wins": 3502,
        "losses": 3182,
        "win_rate": 52.39,
        "first_to_ten_wins": 938,
        "first_to_ten_losses": 469,
        "first_to_ten_win_rate": 66.67,
        "tank_win_rate": 48.52,
        "sl_mmr_data": {"win": 17, "loss": 62, "win_rate": 21.52},
    }
    out = synth(src, seed="w")
    ftt = out["first_to_ten_wins"] / (out["first_to_ten_wins"] + out["first_to_ten_losses"])
    assert out["first_to_ten_win_rate"] == round(ftt * 100, 2)
    assert 35 <= out["tank_win_rate"] <= 65
    mmr = out["sl_mmr_data"]
    assert mmr["win_rate"] == round(mmr["win"] / (mmr["win"] + mmr["loss"]) * 100, 2)


def test_team_level_rises_from_one() -> None:
    src = {
        "experience_breakdown": [
            {"team": t, "TeamLevel": lv} for t in (0, 1) for lv in range(1, 21)
        ]
    }
    rows = synth(src, seed="x")["experience_breakdown"]
    for team in (0, 1):
        levels = [r["TeamLevel"] for r in rows if r["team"] == team]
        assert levels[0] == 1 and levels == sorted(levels) and levels[-1] <= 30


def test_numbers_inside_sentences_are_redrawn() -> None:
    src = {
        "total_time_played": "88 days, 9 hours, 4 minutes, 8 seconds",
        "hovertext": "50.87% win rate over 401 games",
        "ko": "패치 2.57.0 첫 주(9/29~): 밴률 81.6%, 1,379판",
    }
    out = synth(src, seed="h")
    assert out["total_time_played"] != src["total_time_played"]
    assert "days" in out["total_time_played"]
    assert "50.87" not in out["hovertext"] and "401" not in out["hovertext"]
    assert "81.6" not in out["ko"] and "1,379" not in out["ko"]
    assert "2.57.0" in out["ko"] and "9/29" in out["ko"]


def test_hp_matchups_answer_agrees_on_both_sides_and_keeps_the_loss_rate_on_enemies() -> None:
    def row(name: str, w: int, lost: int, text: str) -> dict[str, Any]:
        return {
            "hero": {"id": 1, "name": name},
            "wins": w,
            "losses": lost,
            "games_played": w + lost,
            "win_rate": round(100 * (w if text == "Won" else lost) / (w + lost), 2),
            "hovertext": f"{text} with {name} {50}% of the time.",
        }

    allies = [row(f"A{i}", 60, 40, "Won") for i in range(8)]  # 200 games, 120 wins
    enemies = [row(f"E{i}", 60, 40, "Lost") for i in range(10)]
    src = {
        "ally": allies,
        "enemy": enemies,
        "combined": [{"ally": allies[0], "enemy": enemies[0]}],
    }
    out = synth(src, seed="p")
    ag = sum(r["games_played"] for r in out["ally"])
    eg = sum(r["games_played"] for r in out["enemy"])
    aw = sum(r["wins"] for r in out["ally"])
    ew = sum(r["wins"] for r in out["enemy"])
    assert ag % 4 == 0 and eg % 5 == 0 and ag // 4 == eg // 5
    assert aw % 4 == 0 and ew % 5 == 0 and aw // 4 == ew // 5
    e = out["enemy"][0]
    assert e["win_rate"] == round(e["losses"] / e["games_played"] * 100, 2)
    assert f"{e['win_rate']}%" in e["hovertext"]
    assert out["combined"][0]["enemy"]["games_played"] == e["games_played"]


def test_a_pair_with_no_games_keeps_none() -> None:
    src = {
        "hero": "X",
        "games": 100,
        "wins": 50,
        "ally": [{"hero": "A", "games": 400, "wins": 200}, {"hero": "New", "games": 0, "wins": 0}],
        "enemy": [{"hero": "E", "games": 500, "wins": 250}],
    }
    out = synth(src, seed="z")
    assert out["ally"][1]["games"] == 0 and out["ally"][1]["wins"] == 0


def test_e2e_scenarios_are_set_by_hand_after_the_redraw() -> None:
    from tools.synth_fixtures import scenario

    qm = {
        "rows": [{"hero": "The Butcher", "map": "all", "win_rate": 55.79, "tier_win_rate": 55.8}],
        "party": {"k": 1000, "solo_pooled": 58.68, "solo_games": 265875},
    }
    qm = scenario("web/tests/e2e-data/latest/qm.json", qm)
    assert qm["rows"][0]["tier_win_rate"] == 44.0
    assert qm["party"]["solo_pooled"] < 50  # parties win more often, so solo queue is below 50
    tiers = {"heroes": {"Abathur": [{"games": 300, "wins": 150, "win_rate": 50.0}] * 6}}
    master = scenario("web/tests/e2e-data/latest/sl_tiers.json", tiers)["heroes"]["Abathur"][-1]
    assert master["games"] < 30 and master["win_rate"] == round(
        master["wins"] / master["games"] * 100, 1
    )
    comps = {"groups": {"healer": {"0": {"games": 713, "wins": 380}}}}
    no_healer = scenario("web/tests/e2e-data/latest/sl_comps.json", comps)["groups"]["healer"]["0"]
    assert no_healer["wins"] / no_healer["games"] < 0.37
    other = {"rows": [{"hero": "The Butcher", "map": "all", "tier_win_rate": 55.8}]}
    assert scenario("web/tests/e2e-data/previous/sl.json", other) == other


def test_meta_counts_are_recounted_from_the_mode_files() -> None:
    from tools.synth_fixtures import recount_meta

    meta = {
        "min_games_for_tier": 200,
        "modes": {"qm": {"matches": 5, "heroes": 9, "heroes_over_200": 9, "heroes_ranked": 9}},
    }
    rows = [
        {"hero": "A", "map": "all", "games": 500},
        {"hero": "B", "map": "all", "games": 150},
        {"hero": "A", "map": "Cursed Hollow", "games": 90},
    ]
    out = recount_meta(meta, {"qm": {"matches": 1234, "rows": rows}})
    # the collector's own rule (collector/snapshot.py): ranked from 50 games, healthy from 200
    assert out["modes"]["qm"] == {
        "matches": 1234,
        "heroes": 2,
        "heroes_over_200": 1,
        "heroes_ranked": 2,
    }


def test_quick_match_na_is_a_thin_region() -> None:
    from tools.synth_fixtures import scenario

    rows = [
        {
            "hero": f"H{i:02}",
            "map": "all",
            "games": 900,
            "wins": 450,
            "losses": 450,
            "win_rate": 50.0,
        }
        for i in range(90)
    ]
    out = scenario("web/tests/e2e-data/latest/qm_na.json", {"rows": rows})["rows"]
    ranked = [r for r in out if r["games"] >= 50]
    assert len(ranked) < 45
    for r in out:
        assert r["wins"] + r["losses"] == r["games"]
        assert r["win_rate"] == round(r["wins"] / r["games"] * 100, 1)


def test_a_ranking_kept_as_dict_order_is_reordered_by_the_new_values() -> None:
    src = {"hero_damage": {"A": 71782.49, "B": 70630.48, "C": 68779.28, "D": 61136.73}}
    out = synth(src, seed="r")["hero_damage"]
    values = list(out.values())
    assert values == sorted(values, reverse=True)
