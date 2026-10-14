import { describe, expect, it } from "vitest";
import { TIER_LEAGUES, TIER_MIN_GAMES, tiersView, type TiersFile } from "../src/lib/tiers";

// collector/tiers.py's output (data/latest/sl_tiers.json)
const pt = (games: number, wins: number, corrected: number) => ({ games, wins, win_rate: (wins / games) * 100, tier_win_rate: corrected });
const file: TiersFile = {
  patch: "2.57.0",
  since: "2.57.0.98348",
  collected_at: "2026-10-13T08:00:00Z",
  tiers: [1, 2, 3, 4, 5, 6],
  matches: [1024, 2424, 3817, 3876, 2549, 1402],
  heroes: {
    Sylvanas: [pt(170, 66, 39.5), pt(406, 187, 46.5), pt(790, 371, 47), pt(972, 476, 49), pt(729, 372, 51), pt(458, 261, 56.5)],
    Gall: [null, pt(20, 9, 45), pt(50, 30, 60), pt(32, 14, 44), pt(31, 24, 77), null],
  },
};

describe("tiersView", () => {
  it("one point per league, bronze to master, on the party-corrected rate", () => {
    const v = tiersView(file, "Sylvanas")!;
    expect(v.points.map((p) => p.league)).toEqual(TIER_LEAGUES);
    expect(TIER_LEAGUES).toEqual(["bronze", "silver", "gold", "platinum", "diamond", "master"]);
    expect(v.points[0]).toMatchObject({ games: 170, winRate: 39.5, thin: false });
    expect(v.points[5]!.winRate).toBe(56.5);
    expect(v.patch).toBe("2.57.0");
    expect(v.games).toBe(170 + 406 + 790 + 972 + 729 + 458);
  });

  it("puts the 95% interval around the corrected rate, shifted by the correction", () => {
    const p = tiersView(file, "Sylvanas")!.points[0]!;
    // raw 38.8 %, corrected 39.5 %: the interval moves with it and holds the point
    expect(p.low!).toBeLessThan(39.5);
    expect(p.high!).toBeGreaterThan(39.5);
    expect(p.high! - p.low!).toBeGreaterThan(10);
    expect(p.high! - p.low!).toBeLessThan(20);
  });

  it(`marks a tier under ${TIER_MIN_GAMES} games thin, and a tier without the hero empty`, () => {
    const v = tiersView(file, "Gall")!;
    expect(v.points[0]).toMatchObject({ league: "bronze", games: 0, winRate: null, thin: true });
    expect(v.points[1]).toMatchObject({ games: 20, winRate: 45, thin: true });
    expect(v.points[2]!.thin).toBe(false);
  });

  it("compares each league with that league's all-hero average, which is not 50%: higher leagues beat lower ones", () => {
    const v = tiersView(file, "Sylvanas")!;
    // games-weighted corrected rate of every hero in the league (Sylvanas and Gall here)
    const bronzeAvg = 39.5; // Gall has no bronze row
    const silverAvg = (46.5 * 406 + 45 * 20) / 426;
    expect(v.points[0]!.average).toBeCloseTo(bronzeAvg);
    expect(v.points[1]!.average).toBeCloseTo(silverAvg);
    expect(v.points[1]!.vsAverage).toBeCloseTo(46.5 - silverAvg);
    expect(tiersView(file, "Gall")!.points[0]!.vsAverage).toBeNull();
  });

  it("is null without the file or the hero", () => {
    expect(tiersView(null, "Sylvanas")).toBeNull();
    expect(tiersView(file, "Valla")).toBeNull();
  });
});
