import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PRESETS, changedHeroes, computeTiers, scoreRow, shrinkWinRate, type Row, type Snapshot } from "../src/formula";
import { wilson } from "../src/wilson";

const here = dirname(fileURLToPath(import.meta.url));
const load = (f: string): Snapshot => JSON.parse(readFileSync(join(here, "fixtures", f), "utf-8")) as Snapshot;
const sl = load("sl_2026-09-28.json");
const qm = load("qm_2026-09-28.json");
const allRows = (s: Snapshot): Row[] => s.rows.filter((r) => r.map === "all");
const tierOf = (s: Snapshot, preset = PRESETS.aichi) => {
  const t = computeTiers(allRows(s), preset);
  return Object.fromEntries(t.ranked.map((x) => [x.row.hero, x.tier]));
};
const rankOf = (s: Snapshot, hero: string) => computeTiers(allRows(s), PRESETS.aichi).ranked.findIndex((x) => x.row.hero === hero) + 1;

describe("shrinkWinRate", () => {
  it("pulls small samples toward 50 with k=500", () => {
    expect(shrinkWinRate(60, 500, 500)).toBeCloseTo(55, 6);
    expect(shrinkWinRate(60, 1_000_000, 500)).toBeCloseTo(60, 2);
    expect(shrinkWinRate(40, 0, 500)).toBe(50);
  });
});

describe("scoreRow (aichi, multiplicative)", () => {
  it("is pick × (WRs − 50) × 3 + ban", () => {
    const r: Row = { hero: "X", map: "all", wins: 550, losses: 450, games: 1000, bans: 0, pick: 20, popularity: 20, win_rate: 55, ban_rate: 10, ci: null };
    const wrs = shrinkWinRate(55, 1000, 500); // 53.333
    expect(scoreRow(r, PRESETS.aichi)).toBeCloseTo(20 * (wrs - 50) * 3 + 10, 6);
  });
  it("QM rows have no ban term", () => {
    const r: Row = { hero: "X", map: "all", wins: 550, losses: 450, games: 1000, bans: 0, pick: 20, popularity: 20, win_rate: 55, ban_rate: 0, ci: null };
    expect(scoreRow(r, PRESETS.aichi)).toBeCloseTo(20 * (shrinkWinRate(55, 1000, 500) - 50) * 3, 6);
  });
});

describe("design-doc verification table (2026-09-28 fixtures, aichi default)", () => {
  const expected: Record<string, [string, string]> = {
    Qhira: ["S", "S"], Johanna: ["S", "A"], Rehgar: ["S", "B"], Falstad: ["A", "A"], Illidan: ["A", "B"],
    Azmodan: ["A", "S"], Abathur: ["A", "S"], Gazlowe: ["A", "B"], Samuro: ["B", "B"], Anduin: ["B", "B"],
    Brightwing: ["F", "A"], Stitches: ["F", "D"], Diablo: ["F", "F"],
  };
  const tSl = tierOf(sl);
  const tQm = tierOf(qm);
  for (const [hero, [eSl, eQm]] of Object.entries(expected)) {
    it(`${hero}: SL ${eSl}, QM ${eQm}`, () => {
      expect(tSl[hero]).toBe(eSl);
      expect(tQm[hero]).toBe(eQm);
    });
  }
  it("ranks match the table", () => {
    expect(rankOf(sl, "Qhira")).toBe(1);
    expect(rankOf(sl, "Illidan")).toBe(11);
    expect(rankOf(sl, "Brightwing")).toBe(87);
    expect(rankOf(qm, "Azmodan")).toBe(3);
    expect(rankOf(qm, "Illidan")).toBe(35);
  });
  it("N=90 boundaries are 5/21/48/73/84 → S5 A16 B27 C25 D11 F6", () => {
    const t = computeTiers(allRows(sl), PRESETS.aichi);
    const count = (tier: string) => t.ranked.filter((x) => x.tier === tier).length;
    expect([count("S"), count("A"), count("B"), count("C"), count("D"), count("F")]).toEqual([5, 16, 27, 25, 11, 6]);
    expect(t.grey).toHaveLength(0);
  });
});

describe("presets", () => {
  it("additive preset reproduces the HOTS GG picture on SL", () => {
    const t = tierOf(sl, PRESETS.additive);
    expect(t.Brightwing).toBe("A");
    expect(t.Stitches).toBe("B");
    expect(t.Falstad).toBe("S");
    expect(t.Gazlowe).toBe("B");
  });
  it("pure win-rate preset", () => {
    const t = tierOf(sl, PRESETS.winrate);
    expect(t.Brightwing).toBe("D");
    expect(t.Samuro).toBe("A");
    expect(t.Johanna).toBe("A");
  });
  it("aichi → additive moves 45 heroes on SL and 31 on QM (tier changes only)", () => {
    expect(changedHeroes(allRows(sl), PRESETS.aichi, PRESETS.additive)).toHaveLength(45);
    expect(changedHeroes(allRows(qm), PRESETS.aichi, PRESETS.additive)).toHaveLength(31);
  });
});

describe("cuts and grey rows", () => {
  const mk = (hero: string, games: number, wr: number, pick = 10): Row => ({
    hero, map: "all", wins: Math.round((games * wr) / 100), losses: games - Math.round((games * wr) / 100), games, bans: 0, pick, popularity: pick, win_rate: wr, ban_rate: 0, ci: null,
  });
  it("rows under 200 games are grey and excluded from the denominator", () => {
    const rows = [mk("A", 1000, 55), mk("B", 199, 70), mk("C", 1000, 45)];
    const t = computeTiers(rows, PRESETS.aichi);
    expect(t.grey.map((r) => r.hero)).toEqual(["B"]);
    expect(t.ranked.map((x) => x.row.hero)).toEqual(["A", "C"]);
  });
  it("monotonic cuts: N=3 gives S/A/B one each, C/D/F empty", () => {
    const rows = [mk("A", 1000, 55), mk("B", 1000, 52), mk("C", 1000, 48)];
    const t = computeTiers(rows, PRESETS.aichi);
    expect(t.ranked.map((x) => x.tier)).toEqual(["S", "A", "B"]);
  });
  it("N=12 synthetic map keeps every tier non-empty until it runs out", () => {
    const rows = Array.from({ length: 12 }, (_, i) => mk(`H${i}`, 1000, 60 - i));
    const tiers = computeTiers(rows, PRESETS.aichi).ranked.map((x) => x.tier);
    expect(tiers).toEqual(["S", "A", "B", "B", "B", "B", "C", "C", "C", "D", "D", "F"]);
  });
});

describe("wilson", () => {
  it("95% half-width for 500/1000 is about 3.1 points", () => {
    const [lo, hi] = wilson(500, 1000);
    expect((hi - lo) / 2).toBeCloseTo(3.1, 1);
    expect(lo).toBeLessThan(50);
    expect(hi).toBeGreaterThan(50);
  });
  it("handles zero games", () => {
    expect(wilson(0, 0)).toEqual([0, 100]);
  });
});
