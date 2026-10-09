import { describe, expect, it } from "vitest";
import { heroRowsFromMatches } from "../src/lib/heroStats";
import type { MatchRow } from "../src/lib/matches";

// owner 2026-10-09: the per-hero table comes from the match list already fetched, so it spends no
// player_hero_all quota (500/week) and switching modes asks nothing.
const row = (hero: string, mode: string, win: boolean, s: Partial<MatchRow> = {}): MatchRow =>
  ({
    replay_id: Math.random(), date: null, hero, short_name: hero.toLowerCase(), win, mode, map: null, role: null,
    mmr: null, mmr_change: null, level: null, kills: 4, deaths: 2, assists: 6, takedowns: null, hero_damage: 30000,
    siege_damage: 50000, structure_damage: null, healing: 0, self_healing: null, damage_taken: 20000, experience: 9000,
    time_spent_dead: null, time_cc: null, merc_camps: null, first_to_ten: null, talents: [], ...s,
  }) as MatchRow;

describe("heroRowsFromMatches", () => {
  const games = [
    row("Alarak", "qm", true, { kills: 6, deaths: 2, assists: 4 }),
    row("Alarak", "sl", false, { kills: 2, deaths: 6, assists: 8 }),
    row("Alarak", "qm", true),
    row("Raynor", "sl", true),
  ];
  it("groups per hero, most played first, with averages per game", () => {
    const [a, r] = heroRowsFromMatches(games, "all");
    expect(a).toMatchObject({ hero: "Alarak", games: 3, wins: 2, losses: 1 });
    expect(a!.win_rate).toBeCloseTo(66.67, 1);
    expect(a!.kills).toBeCloseTo(4);
    expect(a!.deaths).toBeCloseTo(10 / 3);
    expect(a!.kda).toBeCloseTo((12 + 18) / 10); // (kills + assists) / deaths over the games
    expect(r).toMatchObject({ hero: "Raynor", games: 1 });
  });
  it("narrows to one mode", () => {
    expect(heroRowsFromMatches(games, "sl").map((h) => [h.hero, h.games])).toEqual([["Alarak", 1], ["Raynor", 1]]);
    expect(heroRowsFromMatches(games, "qm").map((h) => h.hero)).toEqual(["Alarak"]);
  });
  it("a basic list (no stat lines) keeps games and win rate, stats empty", () => {
    const basic = [row("Alarak", "qm", true, { kills: null, deaths: null, assists: null, hero_damage: null, siege_damage: null, healing: null, damage_taken: null, experience: null })];
    const [a] = heroRowsFromMatches(basic, "all");
    expect(a).toMatchObject({ games: 1, wins: 1, win_rate: 100, kda: null, kills: null, hero_damage: null });
  });
  it("a game with no result counts as played, not won or lost", () => {
    const [a] = heroRowsFromMatches([row("Alarak", "qm", null as unknown as boolean)], "all");
    expect(a).toMatchObject({ games: 1, wins: 0, losses: 0 });
  });
});
