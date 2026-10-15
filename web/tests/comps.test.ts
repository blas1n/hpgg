import { describe, expect, it } from "vitest";
import type { MatchupsFile } from "../src/data";
import { COMP_MIN_GAMES, bestReachable, compPenalties, compTerm, groupOf, type CompGroup, type CompsFile, type PoolGroup } from "../src/lib/comps";
import { recommend, type DraftHero } from "../src/lib/draft";

const cell = (games: number, rate: number) => ({ games, wins: Math.round((games * rate) / 100) });
// the shape of collector/team_comps.py; the rates of 2026-10-15 (2.57.0 since 98348, 8,464 games)
const FILE: CompsFile = {
  patch: "2.57.0",
  since: "2.57.0.98348",
  collected_at: "2026-10-15T18:20:00Z",
  games: 8464,
  teams: 16928,
  groups: {
    healer: { "0": cell(134, 37.3), "1": cell(16513, 50.2), "2": cell(281, 42.3) },
    front: { "0": cell(77, 39.0), "1": cell(3385, 48.6), "2": cell(12766, 50.2), "3": cell(700, 54.0) },
    ranged: { "0": cell(212, 56.1), "1": cell(5003, 51.3), "2": cell(11134, 49.6), "3": cell(579, 44.0) },
  },
};
const P = compPenalties(FILE);
/** The cost of n of a group. */
const c = (g: CompGroup, n: number): number => P[g][n]!;

describe("compPenalties", () => {
  it("a count that loses beyond the error costs its gap from 50 %", () => {
    expect(c("healer", 0)).toBeCloseTo(37.3 - 50, 0);
    expect(c("healer", 2)).toBeCloseTo(42.3 - 50, 0);
    expect(c("ranged", 3)).toBeCloseTo(44.0 - 50, 0);
  });

  it("within the error costs nothing (no front-liner: 39.0 % on 77 teams, z = -1.93)", () => {
    expect(c("front", 0)).toBe(0);
    expect(c("front", 1)).toBe(0);
  });

  it("a count that wins more is not chased: only what a team lacks or overdoes costs", () => {
    expect(c("ranged", 0)).toBe(0);
    expect(c("front", 3)).toBe(0);
    expect(c("healer", 1)).toBe(0);
  });

  it(`a count under ${COMP_MIN_GAMES} teams costs nothing however far it is`, () => {
    const thin = { ...FILE, groups: { ...FILE.groups, healer: { ...FILE.groups.healer, "0": cell(COMP_MIN_GAMES - 1, 0) } } };
    expect(compPenalties(thin).healer[0]).toBe(0);
  });
});

describe("groupOf", () => {
  it("healers, front-liners (tank or bruiser), ranged assassins, and the rest", () => {
    expect(groupOf("Healer")).toBe("healer");
    expect(groupOf("Tank")).toBe("front");
    expect(groupOf("Bruiser")).toBe("front");
    expect(groupOf("Ranged Assassin")).toBe("ranged");
    expect(groupOf("Melee Assassin")).toBe("other");
    expect(groupOf("Support")).toBe("other");
    expect(groupOf("")).toBe("other");
  });
});

const PLENTY: Record<PoolGroup, number> = { healer: 10, front: 20, ranged: 30, other: 25 };
const g = (...xs: PoolGroup[]): PoolGroup[] => xs;

describe("bestReachable", () => {
  it("with slots left a team can still fix a missing healer", () => {
    expect(bestReachable(g("front", "ranged"), 3, PLENTY, P)).toBe(0);
  });

  it("with no slot left it is what the team is", () => {
    expect(bestReachable(g("front", "ranged", "ranged", "other", "other"), 0, PLENTY, P)).toBeCloseTo(c("healer", 0), 6);
  });

  it("a healer nobody can pick any more cannot be counted on", () => {
    expect(bestReachable(g("front", "ranged"), 3, { ...PLENTY, healer: 0 }, P)).toBeCloseTo(c("healer", 0), 6);
  });
});

describe("compTerm", () => {
  it("early picks cost nothing: every team can still be completed well", () => {
    expect(compTerm([], g("ranged"), 5, PLENTY, P)).toBe(0);
    expect(compTerm(g("healer"), g("healer"), 4, PLENTY, P)).toBeCloseTo(c("healer", 2), 6); // a second healer is final
  });

  it("the last slot without a healer: anything but a healer costs what no healer costs", () => {
    const team = g("front", "front", "ranged", "other");
    expect(compTerm(team, g("ranged"), 1, PLENTY, P)).toBeCloseTo(c("healer", 0), 6);
    expect(compTerm(team, g("healer"), 1, PLENTY, P)).toBe(0);
  });

  it("two slots, no healer: a non-healer still leaves room, so it costs nothing yet", () => {
    expect(compTerm(g("front", "ranged", "other"), g("front"), 2, PLENTY, P)).toBe(0);
  });

  it("a third ranged assassin costs what three ranged cost", () => {
    expect(compTerm(g("healer", "ranged", "ranged"), g("ranged"), 2, PLENTY, P)).toBeCloseTo(c("ranged", 3), 6);
  });

  it("is never positive", () => {
    for (const x of g("healer", "front", "ranged", "other")) expect(compTerm(g("front"), [x], 4, PLENTY, P)).toBeLessThanOrEqual(0);
  });
});

const h = (slug: string, role: string, wrs = 50): DraftHero => ({ slug, name: slug, ko: slug, role, role_ko: role, wrs, wr: wrs, games: 1000, maps: {} });
const NONE = new Map<string, MatchupsFile>();

describe("recommend with team compositions", () => {
  // first team: bans b1 b3, picks f1 f2 f3 f4, its last pick is step 14 (index 14)
  const heroes = [
    ...["b1", "b2", "b3", "b4", "b5", "b6"].map((s) => h(s, "Support")),
    h("f1", "Tank"), h("f2", "Ranged Assassin"), h("f3", "Ranged Assassin"), h("f4", "Melee Assassin"),
    h("s1", "Healer"), h("s2", "Tank"), h("s3", "Bruiser"), h("s4", "Ranged Assassin"),
    h("star", "Ranged Assassin", 54),
    h("heal", "Healer", 50),
  ];
  // order: ban A, ban B, ban A, ban B, A, B B, A A, ban B, ban A, B B, A A, B
  const seq = ["b1", "b2", "b3", "b4", "f1", "s1", "s2", "f2", "f3", "b5", "b6", "s3", "s4", "f4"];

  it("the first team's last pick without a healer: the healer ranks over a stronger ranged assassin", () => {
    const out = recommend(heroes, seq, { matchups: NONE, map: null, comps: P });
    expect(out[0]!.hero.slug).toBe("heal");
    const star = out.find((s) => s.hero.slug === "star")!;
    expect(star.terms.comp).toBeCloseTo(c("ranged", 3) + c("healer", 0), 6);
    expect(star.score).toBeCloseTo(4 * 0.7 + c("ranged", 3) + c("healer", 0), 6); // base × 0.7, team × 1
    expect(out[0]!.terms.comp).toBe(0);
  });

  it("no compositions file: the term is 0 and the order is the old one", () => {
    const out = recommend(heroes, seq, { matchups: NONE, map: null, comps: null });
    expect(out[0]!.hero.slug).toBe("star");
    expect(out.every((s) => s.terms.comp === 0)).toBe(true);
  });

  it("a ban weighs the other team's needs: what the first team would most want, a third ranged costs it", () => {
    // step 9 (index 9) is the second team's ban: it scores for the first team (tank + 2 ranged, 2 slots left)
    const out = recommend(heroes, seq.slice(0, 9), { matchups: NONE, map: null, comps: P });
    expect(out.find((s) => s.hero.slug === "heal")!.terms.comp).toBe(0);
    expect(out.find((s) => s.hero.slug === "star")!.terms.comp).toBeCloseTo(c("ranged", 3), 6);
    // b5 / b6 (supports) are still on the board and cost nothing either; the healer ranks over the stronger ranged
    const rank = (slug: string) => out.findIndex((s) => s.hero.slug === slug);
    expect(rank("heal")).toBeLessThan(rank("star"));
  });
});
