import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { HeroTable } from "../src/data";
import { teamLuckView, type TeamLuckResponse } from "../src/lib/teamLuck";

// 팀운 (#90, owner 2026-10-06): per game, the 4 teammates' mean MMR − the 5 opponents' before the game
// (server/players/teamluck.py), over the newest games of a mode.

const here = dirname(fileURLToPath(import.meta.url));
const heroes = JSON.parse(readFileSync(join(here, "..", "..", "data", "heroes_ko.json"), "utf-8")) as HeroTable;

const game = (gap: number, win: boolean, hero = "Illidan", id = 1) => ({
  replay_id: id,
  date: "2026-10-05 12:00:00",
  mode: "sl",
  hero,
  win,
  team_mmr: 2300 + gap,
  opp_mmr: 2300,
  gap,
});
const resp = (games: ReturnType<typeof game>[], extra: Partial<TeamLuckResponse> = {}): TeamLuckResponse => ({
  mode: "all",
  games,
  summary: {
    games: games.length,
    gap_avg: games.length ? games.reduce((s, g) => s + g.gap, 0) / games.length : null,
    good: { games: games.filter((g) => g.gap >= 50).length, wins: games.filter((g) => g.gap >= 50 && g.win).length },
    bad: { games: games.filter((g) => g.gap <= -50).length, wins: games.filter((g) => g.gap <= -50 && g.win).length },
    even: { games: games.filter((g) => Math.abs(g.gap) < 50).length, wins: games.filter((g) => Math.abs(g.gap) < 50 && g.win).length },
  },
  partial: false,
  formula: { gap: "…", good: 50 },
  ...extra,
});

describe("teamLuckView", () => {
  it("says whether the teammates were stronger, by how much, over how many games", () => {
    const v = teamLuckView(resp([game(120, true), game(-20, false), game(40, true)]), heroes, "ko")!;
    expect(v.games).toBe(3);
    expect(v.gapAvg).toBeCloseTo(46.7, 1);
    expect(v.verdict).toBe("even"); // within ±50: neither lucky nor unlucky
    expect(v.good).toEqual({ games: 1, winRate: 100 });
    expect(v.bad).toEqual({ games: 0, winRate: null });
  });

  it("a gap of 50 or more either way is luck", () => {
    expect(teamLuckView(resp([game(80, true), game(60, true)]), heroes, "ko")!.verdict).toBe("good");
    expect(teamLuckView(resp([game(-80, false), game(-60, true)]), heroes, "ko")!.verdict).toBe("bad");
  });

  it("each game carries its hero in the page language and its gap, newest first as the API gives them", () => {
    const v = teamLuckView(resp([game(120, true, "Illidan", 7), game(-90, false, "Qhira", 6)]), heroes, "ko")!;
    expect(v.rows.map((r) => [r.id, r.hero, r.gap, r.win])).toEqual([
      [7, "일리단", 120, true],
      [6, "키히라", -90, false],
    ]);
    // a bar's length is its gap against the largest in the list
    expect(v.rows[0]!.bar).toBeCloseTo(1);
    expect(v.rows[1]!.bar).toBeCloseTo(-0.75);
  });

  it("no countable game is nothing to show; a partial answer says so", () => {
    expect(teamLuckView(resp([]), heroes, "ko")).toBeNull();
    expect(teamLuckView(resp([game(10, true)], { partial: true }), heroes, "ko")!.partial).toBe(true);
  });
});
