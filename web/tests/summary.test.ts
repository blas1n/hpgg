import { describe, expect, it } from "vitest";
import type { HeroSummary, MapRow } from "../src/lib/hero";
import type { MatchupRow, MatchupsView } from "../src/lib/matchups";
import { summaryLines } from "../src/lib/summary";

const ranked = (win_rate: number, prevWinRate: number | null): HeroSummary => ({
  kind: "ranked",
  tier: "B",
  rank: 12,
  delta: null,
  prevRank: null,
  prevWinRate,
  hasPrevious: prevWinRate !== null,
  win_rate,
  games: 5000,
  pick: 10,
  ban_rate: 1,
});
const map = (slug: string, ko: string, win_rate: number, thin = false): MapRow => ({ slug, name: slug, ko, win_rate, pick: 5, games: thin ? 50 : 900, thin });
const pair = (hero: string, delta: number, games: number): MatchupRow => ({ hero, slug: hero.toLowerCase(), ko: hero, games, win_rate: 50 + delta, delta, score: delta / 2 });
const matchups = (counters: MatchupRow[], synergies: MatchupRow[]): MatchupsView => ({ patch: "p", collectedAt: "2026-09-29T00:00:00Z", win_rate: 50, games: 1000, counters, synergies });

describe("summaryLines", () => {
  it("change against the previous patch, then the strongest map with enough games", () => {
    const lines = summaryLines(ranked(53.2, 51.1), [map("tod", "파멸의 탑", 60, true), map("ch", "저주받은 골짜기", 56.1), map("bh", "블랙하트 항만", 49)], null);
    expect(lines).toEqual([
      { key: "change", wrChange: expect.closeTo(2.1, 5) },
      { key: "map", map: { slug: "ch", ko: "저주받은 골짜기", win_rate: 56.1 } },
    ]);
  });

  it("no ranked previous patch and every map thin → neither line (nothing to say beyond the cards)", () => {
    expect(summaryLines(ranked(53, null), [map("tod", "파멸의 탑", 60, true)], null)).toEqual([]);
  });

  it("previous patch only → the change line alone", () => {
    expect(summaryLines(ranked(48, 50), [], null)).toEqual([{ key: "change", wrChange: -2 }]);
  });

  it("grey or absent hero: no change or map line — a thin sample is not a finding", () => {
    const grey: HeroSummary = { kind: "grey", win_rate: 70, games: 40, pick: 1 };
    expect(summaryLines(grey, [map("ch", "저주받은 골짜기", 56)], null)).toEqual([]);
    expect(summaryLines({ kind: "none" }, [], null)).toEqual([]);
  });

  it("watch / pair: the top counter and the top synergy with their gap and games", () => {
    const v = matchups([pair("Qhira", -8.7, 412), pair("Muradin", -3, 900)], [pair("Samuro", 6.2, 380)]);
    const lines = summaryLines({ kind: "none" }, [], v);
    expect(lines).toEqual([
      { key: "watch", hero: v.counters[0] },
      { key: "pair", hero: v.synergies[0] },
    ]);
  });

  it("no counters or synergies over the floor → those lines are left out", () => {
    expect(summaryLines({ kind: "none" }, [], matchups([], [pair("Samuro", 6.2, 380)])).map((l) => l.key)).toEqual(["pair"]);
    expect(summaryLines({ kind: "none" }, [], matchups([], []))).toEqual([]);
  });
});
