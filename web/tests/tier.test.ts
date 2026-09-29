import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { knownOnly } from "../src/lib/known";
import { changedHeroes, PRESETS, type Snapshot } from "../src/formula";
import type { HeroTable, Meta } from "../src/data";
import { DEFAULT_TIER_STATE, formatScore, parseTierState, resolvePatch, tierSearch, tierTable, visibleRows, type TierState } from "../src/lib/tier";

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
    const s: TierState = { mode: "sl", bracket: "high", region: "all", map: "Cursed Hollow", role: "Tank", patch: "previous", sort: "win_rate", dir: "asc", preset: "additive" };
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

describe("?preset=", () => {
  it("reads additive / winrate, ignores anything else, and is left out of the URL for the default (아이치)", () => {
    expect(DEFAULT_TIER_STATE.preset).toBe("aichi");
    expect(parseTierState("?preset=additive").preset).toBe("additive");
    expect(parseTierState("?preset=winrate&mode=sl").preset).toBe("winrate");
    expect(parseTierState("?preset=bogus").preset).toBe("aichi");
    expect(parseTierState("?preset=aichi").preset).toBe("aichi");
    expect(tierSearch({ ...DEFAULT_TIER_STATE, preset: "winrate" })).toBe("preset=winrate");
  });
});

describe("resolvePatch", () => {
  const thin: Meta = { ...meta, previous_patch: "2.55.17.97771", modes: { qm: { matches: 10, heroes: 90, heroes_over_200: 10 } } };

  it("falls back to the previous patch on a thin sample unless the URL chose a patch", () => {
    expect(resolvePatch(thin, "qm", "auto")).toEqual({ patch: "previous", auto: true });
    expect(resolvePatch(thin, "qm", "current")).toEqual({ patch: "current", auto: false });
  });

  it("uses the current patch when the sample is healthy or there is no previous patch", () => {
    expect(resolvePatch({ ...meta, previous_patch: "x" }, "qm", "auto")).toEqual({ patch: "current", auto: false });
    expect(resolvePatch({ ...thin, previous_patch: null }, "qm", "previous")).toEqual({ patch: "current", auto: false });
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
    expect(t.rows.length + t.grey.length).toBe(rows.length);
    expect(t.grey.length).toBeGreaterThan(0);
    expect(t.grey.every((g) => g.games < 200)).toBe(true);
    expect(t.matches).toBe(Math.round(rows.reduce((a, r) => a + r.games, 0) / 10));
    expect(tierTable(sl, null, "all", heroes, 200).matches).toBe(sl.matches);
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

describe("tierTable with a formula preset", () => {
  it("the default preset is the old call, value for value — no new keys on the pre-rendered table", () => {
    const prev: Snapshot = { ...qm, rows: qm.rows.filter((r) => r.hero !== "Qhira") };
    const old = tierTable(qm, prev, "all", heroes, 200);
    const withPreset = tierTable(qm, prev, "all", heroes, 200, PRESETS.aichi);
    expect(JSON.stringify(withPreset)).toBe(JSON.stringify(old));
    expect(old.rows.some((r) => "baseTier" in r)).toBe(false);
  });

  it("another preset re-tiers the same rows and marks exactly the heroes whose tier differs from 아이치", () => {
    for (const [snap, preset] of [
      [qm, PRESETS.additive],
      [sl, PRESETS.additive],
      [sl, PRESETS.winrate],
    ] as const) {
      const aichi = tierTable(snap, null, "all", heroes, 200);
      const t = tierTable(snap, null, "all", heroes, 200, preset);
      expect(t.rows).toHaveLength(aichi.rows.length);
      const marked = t.rows.filter((r) => r.baseTier !== undefined);
      const expected = changedHeroes(snap.rows.filter((r) => r.map === "all"), PRESETS.aichi, preset, 200);
      expect(marked.map((r) => r.hero.name).sort()).toEqual(expected);
      expect(marked.length).toBeGreaterThan(0);
      for (const r of marked) expect(r.baseTier).toBe(aichi.rows.find((a) => a.hero.slug === r.hero.slug)!.tier);
      for (const r of marked) expect(r.baseTier).not.toBe(r.tier);
    }
  });

  it("ranks the previous patch with the same preset for ▲▼", () => {
    const prev: Snapshot = { ...sl, rows: sl.rows.map((r) => ({ ...r })) };
    const t = tierTable(sl, prev, "all", heroes, 200, PRESETS.winrate);
    expect(t.rows.every((r) => r.prevRank === r.rank)).toBe(true); // same data: no movement under the same formula
  });

  it("formats the score for the preset's scale", () => {
    expect(formatScore(396.6, PRESETS.aichi)).toBe("+397");
    expect(formatScore(-12.2, PRESETS.aichi)).toBe("-12");
    expect(formatScore(3.456, PRESETS.additive)).toBe("+3.5");
    expect(formatScore(-0.04, PRESETS.additive)).toBe("-0.0");
    expect(formatScore(52.345, PRESETS.winrate)).toBe("52.3");
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
