import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Snapshot } from "../src/formula";
import type { HeroTable, Meta } from "../src/data";
import { DEFAULT_TIER_STATE, parseTierState, resolvePatch, tierSearch, tierTable, visibleRows, type TierState } from "../src/lib/tier";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "e2e-data");
const json = <T>(rel: string): T => JSON.parse(readFileSync(join(dataDir, rel), "utf-8")) as T;
const heroes = json<HeroTable>("heroes_ko.json");
const meta = json<Meta>("latest/meta.json");
const qm = json<Snapshot>("latest/qm.json");
const sl = json<Snapshot>("latest/sl.json");

describe("parseTierState / tierSearch", () => {
  it("an empty query is the default view: Quick Match, all maps, every role, by score descending", () => {
    expect(parseTierState("")).toEqual(DEFAULT_TIER_STATE);
    expect(tierSearch(DEFAULT_TIER_STATE)).toBe("");
  });

  it("round-trips every non-default field", () => {
    const s: TierState = { mode: "sl", bracket: "high", map: "Cursed Hollow", role: "Tank", patch: "previous", sort: "win_rate", dir: "asc" };
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
