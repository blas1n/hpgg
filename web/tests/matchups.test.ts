import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { HeroTable, MatchupsFile } from "../src/data";
import { MATCHUP_K, MATCHUP_MIN_GAMES, MATCHUP_TOP, matchupScore, matchupsView } from "../src/lib/matchups";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "e2e-data");
const json = <T>(rel: string): T => JSON.parse(readFileSync(join(dataDir, rel), "utf-8")) as T;
const heroes = json<HeroTable>("heroes_ko.json");
// normalised from the live /heroes/matchups answer recorded 2026-09-29 (Abathur, SL, 2.55.17.98025)
const abathur = json<MatchupsFile>("matchups/abathur.json");

describe("matchupScore", () => {
  it("shrinks the win-rate gap toward 0 by n / (n + k)", () => {
    expect(matchupScore(60, 50, MATCHUP_K)).toBeCloseTo(5); // n = k halves the gap
    expect(matchupScore(40, 50, 1_000_000)).toBeCloseTo(-10, 2); // a huge sample keeps it
  });
  it("a small sample with a big gap ranks below a big sample with a moderate gap", () => {
    expect(matchupScore(80, 50, 10)).toBeLessThan(matchupScore(56, 50, 400));
  });
});

describe("matchupsView", () => {
  const v = matchupsView(abathur, heroes)!;

  it("carries patch, date and the hero's own win rate from the same sample", () => {
    expect(v.patch).toBe("2.55.17.98025");
    expect(v.collectedAt).toBe("2026-09-29T00:27:00Z");
    expect(v.win_rate).toBe(50.79);
    expect(v.games).toBe(4855);
  });

  it("top 5 counters: enemy heroes, worst first, all below the hero's own win rate and above the floor", () => {
    expect(v.counters).toHaveLength(MATCHUP_TOP);
    for (const r of v.counters) {
      expect(r.games).toBeGreaterThanOrEqual(MATCHUP_MIN_GAMES);
      expect(r.delta).toBeLessThan(0);
    }
    const scores = v.counters.map((r) => r.score);
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
  });

  it("top 5 synergies: ally heroes, best first, above the hero's own win rate", () => {
    expect(v.synergies).toHaveLength(MATCHUP_TOP);
    for (const r of v.synergies) expect(r.delta).toBeGreaterThan(0);
    const scores = v.synergies.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("the floor keeps a tiny sample off the list even with the biggest gap", () => {
    const tiny = { hero: "Probius", games: 10, wins: 0, win_rate: 0 };
    const file: MatchupsFile = { ...abathur, enemy: [tiny, ...abathur.enemy.filter((r) => r.hero !== "Probius")] };
    expect(matchupsView(file, heroes)!.counters.map((r) => r.hero)).not.toContain("Probius");
  });

  it("resolves Korean names, slugs and portraits; an unknown hero keeps its API name and no link", () => {
    const fenixRow = { hero: "Fenix", games: 4000, wins: 800, win_rate: 20 };
    const newHero = { hero: "Newhero", games: 4000, wins: 400, win_rate: 10 };
    const w = matchupsView({ ...abathur, enemy: [fenixRow, newHero] }, heroes)!;
    expect(w.counters.map((r) => [r.hero, r.slug, r.ko])).toEqual([
      ["Newhero", undefined, "Newhero"],
      ["Fenix", "fenix", "피닉스"],
    ]);
    expect(w.counters[1]!.portrait).toBe("img/heroes/fenix.png");
    expect(w.counters[1]!.delta).toBeCloseTo(20 - 50.79);
  });

  it("no file → null (the page says the data comes with the next collection)", () => {
    expect(matchupsView(null, heroes)).toBeNull();
  });
});
