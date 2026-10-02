import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { knownOnly } from "../src/lib/known";
import type { Snapshot } from "../src/formula";
import type { HeroTable, Meta } from "../src/data";
import { DEFAULT_TIER_STATE, formatScore, nextSort, parseTierState, resolvePatch, tierSearch, tierTable, visibleRows, type TierState } from "../src/lib/tier";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "e2e-data");
const json = <T>(rel: string): T => JSON.parse(readFileSync(join(dataDir, rel), "utf-8")) as T;
const heroes = json<HeroTable>("heroes_ko.json");
const meta = json<Meta>("latest/meta.json");
// what the pages see: the e2e stats carry a hero without assets (Xal'atath), dropped by lib/known.ts
const qm = knownOnly(json<Snapshot>("latest/qm.json"), heroes);
const sl = knownOnly(json<Snapshot>("latest/sl.json"), heroes);

describe("parseTierState / tierSearch", () => {
  it("an empty query is the default view: Quick Match, all maps, every role, by score descending", () => {
    expect(parseTierState("")).toEqual(DEFAULT_TIER_STATE);
    expect(tierSearch(DEFAULT_TIER_STATE)).toBe("");
  });

  it("round-trips every non-default field", () => {
    const s: TierState = { mode: "sl", bracket: "high", region: "all", map: "Cursed Hollow", role: "Tank", patch: "previous", sort: "win_rate", dir: "asc" };
    expect(parseTierState(tierSearch(s))).toEqual(s);
  });

  it("drops Storm-League-only fields in Quick Match and rejects unknown values", () => {
    expect(parseTierState("?tier=high&map=Cursed%20Hollow")).toMatchObject({ mode: "qm", bracket: "all", map: "all" });
    expect(parseTierState("?mode=sl&tier=mid&sort=bogus&dir=up")).toMatchObject({ bracket: "all", sort: "score", dir: "desc" });
  });

  it("keeps an explicit ?patch=current so a reload does not fall back to the previous patch again", () => {
    expect(parseTierState("?patch=current").patch).toBe("current");
    expect(tierSearch({ ...DEFAULT_TIER_STATE, patch: "current" })).toBe("patch=current");
  });
});

describe("?preset= (formula presets were removed)", () => {
  it("an old ?preset= link opens the one formula and the parameter is dropped from the URL", () => {
    expect(parseTierState("?preset=additive")).toEqual(DEFAULT_TIER_STATE);
    expect(parseTierState("?preset=winrate&mode=sl")).toEqual({ ...DEFAULT_TIER_STATE, mode: "sl" });
    expect(tierSearch(parseTierState("?preset=additive&role=Tank"))).toBe("role=Tank");
  });
});


describe("resolvePatch", () => {
  const ref: Meta = { ...meta, previous_patch: "2.55.17.97771", reference_patch: "2.55.17.97771" };

  it("auto is the reference patch; a patch chosen in the URL wins", () => {
    expect(resolvePatch(ref, "auto")).toEqual({ patch: "previous", auto: true });
    expect(resolvePatch(ref, "current")).toEqual({ patch: "current", auto: false });
    expect(resolvePatch({ ...ref, reference_patch: ref.current_patch }, "auto")).toEqual({ patch: "current", auto: false });
  });

  it("no previous patch: always the current one", () => {
    expect(resolvePatch({ ...ref, previous_patch: null }, "previous")).toEqual({ patch: "current", auto: false });
    expect(resolvePatch({ ...ref, previous_patch: null }, "auto")).toEqual({ patch: "current", auto: false });
  });
});

describe("tierTable", () => {
  it("ranks the fixture like the formula: Qhira #1, Azmodan S, Illidan B in Quick Match", () => {
    const t = tierTable(qm, null, "all", heroes, 200);
    expect(t.rows[0]!.hero.slug).toBe("qhira");
    expect(t.rows[0]!.rank).toBe(1);
    expect(t.rows.find((r) => r.hero.slug === "azmodan")!.tier).toBe("S");
    expect(t.rows.find((r) => r.hero.slug === "illidan")!.tier).toBe("B");
    expect(t.hasPrevious).toBe(false);
    expect(t.patch).toBe(qm.patch);
    expect(t.collectedAt).toBe(qm.collected_at);
    expect(t.rows.every((r) => r.prevRank === null)).toBe(true);
  });

  it("carries the previous rank per hero; a hero missing there is new", () => {
    const prev: Snapshot = { ...qm, rows: qm.rows.filter((r) => r.hero !== "Qhira") };
    const t = tierTable(qm, prev, "all", heroes, 200);
    expect(t.hasPrevious).toBe(true);
    expect(t.rows.find((r) => r.hero.slug === "qhira")!.prevRank).toBeNull();
    expect(t.rows.find((r) => r.hero.slug === "illidan")!.prevRank).toBeGreaterThan(0);
  });

  it("carries the party correction for the printed formula only on the view that has it", () => {
    const party = { k: 1000, solo_pooled: 48.63, solo_games: 1000 };
    const snap: Snapshot = { ...qm, party, rows: qm.rows.map((r) => (r.map === "all" ? { ...r, tier_win_rate: r.win_rate } : r)) };
    expect(tierTable(snap, null, "all", heroes, 200).party).toEqual(party);
    expect(tierTable({ ...qm, party: null }, null, "all", heroes, 200).party).toBeNull();
    const slSnap: Snapshot = { ...sl, party, rows: sl.rows.map((r) => (r.map === "all" ? { ...r, tier_win_rate: r.win_rate } : r)) };
    const map = sl.rows.find((r) => r.map !== "all")!.map;
    expect(tierTable(slSnap, null, "all", heroes, 200).party).toEqual(party);
    expect(tierTable(slSnap, null, map, heroes, 200).party).toBeNull();
  });

  it("ignores a previous snapshot of a different bracket cohort", () => {
    const prev: Snapshot = { ...sl, league_tier: [1, 2] };
    const cur: Snapshot = { ...sl, league_tier: [1, 2, 3, 4] };
    expect(tierTable(cur, prev, "all", heroes, 200).hasPrevious).toBe(false);
  });

  it("one map: only that map's rows; thin heroes go to grey, and matches are games / 10", () => {
    const t = tierTable(sl, null, "Cursed Hollow", heroes, 200);
    const rows = sl.rows.filter((r) => r.map === "Cursed Hollow");
    // every hero on the site is either ranked or grey, played on this map or not
    expect(t.rows.length + t.grey.length).toBe(heroes.heroes.length);
    expect(t.grey.length).toBeGreaterThan(0);
    expect(t.grey.every((g) => g.games < 200)).toBe(true);
    expect(t.matches).toBe(Math.round(rows.reduce((a, r) => a + r.games, 0) / 10));
    expect(tierTable(sl, null, "all", heroes, 200).matches).toBe(sl.matches);
  });

  it("a hero with no game in the view is grey with 0 games, after the ones that played (KR 다마그, 10-02)", () => {
    const one = qm.rows.filter((r) => r.map === "all").slice(0, 2).map((r) => ({ ...r, games: 1, wins: 1 }));
    const t = tierTable({ ...qm, rows: one }, null, "all", heroes, 50);
    expect(t.rows).toHaveLength(0);
    expect(t.grey).toHaveLength(heroes.heroes.length);
    expect(t.grey.slice(0, 2).map((g) => g.games)).toEqual([1, 1]);
    expect(t.grey.slice(2).every((g) => g.games === 0)).toBe(true);
    expect(new Set(t.grey.map((g) => g.hero.slug)).size).toBe(heroes.heroes.length);
  });

  it("gives each row a Wilson 95% half-width", () => {
    const r = tierTable(qm, null, "all", heroes, 200).rows[0]!;
    expect(r.wrHalf).toBeGreaterThan(0);
    expect(r.wrHalf).toBeLessThan(5);
  });

  it("keeps a hero missing from heroes_ko with its English name instead of dropping it", () => {
    const extra: Snapshot = { ...qm, rows: [...qm.rows, { ...qm.rows[0]!, hero: "Xal'atath" }] };
    const x = tierTable(extra, null, "all", heroes, 200).rows.find((r) => r.hero.name === "Xal'atath")!;
    expect(x.hero.ko).toBe("Xal'atath");
    expect(x.hero.slug).toBe("xal-atath");
  });
});

describe("formatScore", () => {
  it("prints the score in whole points with a sign", () => {
    expect(formatScore(396.6)).toBe("+397");
    expect(formatScore(-12.2)).toBe("-12");
  });
});


describe("visibleRows", () => {
  const t = tierTable(qm, null, "all", heroes, 200);

  it("sorts by the chosen column; ties keep the score rank", () => {
    const byPick = visibleRows(t.rows, "all", "pick", "desc");
    expect(byPick[0]!.hero.slug).toBe("abathur");
    const asc = visibleRows(t.rows, "all", "pick", "asc");
    expect(asc[0]!.pick).toBeLessThanOrEqual(asc[1]!.pick);
  });

  it("filters by role without re-ranking", () => {
    const healers = visibleRows(t.rows, "Healer", "score", "desc");
    expect(healers.every((r) => r.hero.role === "Healer")).toBe(true);
    expect(healers.find((r) => r.hero.slug === "brightwing")!.tier).toBe("A");
    expect(healers[0]!.rank).toBeGreaterThan(0);
  });
});

describe("nextSort", () => {
  it("a new column sorts descending; the same column again flips the direction", () => {
    expect(nextSort({ sort: "score", dir: "desc" }, "win_rate")).toEqual({ sort: "win_rate", dir: "desc" });
    expect(nextSort({ sort: "win_rate", dir: "desc" }, "win_rate")).toEqual({ sort: "win_rate", dir: "asc" });
    expect(nextSort({ sort: "win_rate", dir: "asc" }, "win_rate")).toEqual({ sort: "win_rate", dir: "desc" });
  });

  it("rank (the rank and tier headers) always returns to the ranked order, whatever is sorted now", () => {
    expect(nextSort({ sort: "win_rate", dir: "asc" }, "rank")).toEqual({ sort: "score", dir: "desc" });
    expect(nextSort({ sort: "games", dir: "desc" }, "rank")).toEqual({ sort: "score", dir: "desc" });
    // already ranked (even reversed by the score header): back to #1 first, never a flip
    expect(nextSort({ sort: "score", dir: "asc" }, "rank")).toEqual({ sort: "score", dir: "desc" });
    expect(nextSort({ sort: "score", dir: "desc" }, "rank")).toEqual({ sort: "score", dir: "desc" });
  });
});
