import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { computeTiers, PRESETS, type Row, type Snapshot } from "../src/formula";
import { fallbackNote, type HeroTable, type MapTable } from "../src/data";
import { homeModel, mapCards, movers, roleLeaders, topHeroes } from "../src/lib/home";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "e2e-data");
const json = <T>(rel: string): T => JSON.parse(readFileSync(join(dataDir, rel), "utf-8")) as T;
const heroes = json<HeroTable>("heroes_ko.json");
const maps = json<MapTable>("maps_ko.json");
const qm = json<Snapshot>("latest/qm.json");
const sl = json<Snapshot>("latest/sl.json");
const ranked = (rows: Row[]) => computeTiers(rows.filter((r) => r.map === "all"), PRESETS.aichi).ranked;

describe("roleLeaders", () => {
  const leaders = roleLeaders(ranked(qm.rows), heroes);

  it("has one card per role, in the role order of heroes_ko", () => {
    expect(leaders.map((l) => l.role)).toEqual(heroes.roles.map((r) => r.name));
  });

  it("picks the best-ranked hero of each role (Whitemane leads healers in the QM fixture)", () => {
    const healer = leaders.find((l) => l.role === "Healer")!;
    expect(healer.hero.slug).toBe("whitemane");
    expect(healer.role_ko).toBe("치유사");
    const healerRanks = ranked(qm.rows).filter((x) => heroes.heroes.find((h) => h.name === x.row.hero)?.role === "Healer");
    expect(healer.rank).toBe(healerRanks[0]!.rank);
  });
});

describe("topHeroes", () => {
  it("returns the first N by rank with the previous-patch rank delta", () => {
    const cur = ranked(qm.rows);
    // previous patch: swap the first two heroes' order by giving #2 a higher score
    const prev = cur.map((x, i) => ({ ...x, rank: i === 0 ? 2 : i === 1 ? 1 : x.rank }));
    const top = topHeroes(cur, prev, heroes, 10);
    expect(top).toHaveLength(10);
    expect(top.map((t) => t.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(top[0]!.hero.slug).toBe("qhira");
    expect(top[0]!.delta).toBe(1); // was #2, now #1
    expect(top[1]!.delta).toBe(-1);
    expect(top[2]!.delta).toBe(0);
  });

  it("uses null deltas when there is no previous patch", () => {
    const top = topHeroes(ranked(qm.rows), null, heroes, 3);
    expect(top).toHaveLength(3);
    expect(top.every((t) => t.delta === null)).toBe(true);
  });
});

describe("movers", () => {
  const cur = ranked(qm.rows);
  // previous ranks: reverse order, so heroes near the top climbed and heroes near the bottom fell
  const n = cur.length;
  const prev = cur.map((x) => ({ ...x, rank: n + 1 - x.rank }));

  it("splits risers and fallers, each sorted by the size of the move", () => {
    const m = movers(cur, prev, heroes, 5);
    expect(m.up).toHaveLength(5);
    expect(m.down).toHaveLength(5);
    expect(m.up[0]!.rank).toBe(1);
    expect(m.up[0]!.prevRank).toBe(n);
    expect(m.up[0]!.delta).toBe(n - 1);
    expect(m.up.every((x, i, a) => x.delta > 0 && (i === 0 || a[i - 1]!.delta >= x.delta))).toBe(true);
    expect(m.down[0]!.rank).toBe(n);
    expect(m.down[0]!.delta).toBe(1 - n);
    expect(m.down.every((x, i, a) => x.delta < 0 && (i === 0 || a[i - 1]!.delta <= x.delta))).toBe(true);
  });

  it("carries the previous win rate for the → line", () => {
    const m = movers(cur, prev, heroes, 1);
    expect(m.up[0]!.win_rate).toBe(cur[0]!.row.win_rate);
    expect(typeof m.up[0]!.prevWinRate).toBe("number");
  });

  it("is empty when nothing moved", () => {
    expect(movers(cur, cur, heroes, 5)).toEqual({ up: [], down: [] });
  });
});

describe("mapCards", () => {
  it("lists maps that have Storm League rows, most matches first, with the top 3 heroes of each", () => {
    const cards = mapCards(sl, maps, heroes, 200, 6);
    // the e2e SL fixture has a single real map
    expect(cards.map((c) => c.slug)).toEqual(["cursed-hollow"]);
    const c = cards[0]!;
    expect(c.ko).toBe("저주받은 골짜기");
    expect(c.matches).toBeGreaterThan(0);
    expect(c.top).toHaveLength(3);
    expect(c.top[0]!.tier).toBe("S");
  });
});

describe("homeModel", () => {
  it("bundles one mode's sections; without a previous patch there are no movers or deltas", () => {
    const m = homeModel("qm", qm, null, "2.55.17.97771", heroes, 200);
    expect(m.mode).toBe("qm");
    expect(m.patch).toBe(qm.patch);
    expect(m.matches).toBe(qm.matches);
    expect(m.leaders).toHaveLength(6);
    expect(m.top).toHaveLength(10);
    expect(m.movers).toBeNull();
    expect(m.previousPatch).toBeNull(); // no previous snapshot → no "vs previous patch" line
    expect(m.top.every((t) => t.delta === null)).toBe(true);
    expect(m.fallbackFrom).toBeNull();
  });

  it("carries the thin current patch it fell back from, and the page says so in one shared sentence", () => {
    expect(homeModel("qm", qm, null, null, heroes, 200, "2.57.0.98285").fallbackFrom).toBe("2.57.0.98285");
    expect(fallbackNote("2.57.0.98285")).toBe("새 패치 2.57.0.98285 표본이 아직 적어 이전 패치 기준");
  });

  it("carries the previous patch and movers when the previous snapshot exists", () => {
    const m = homeModel("sl", sl, sl, "2.55.17.97771", heroes, 200);
    expect(m.previousPatch).toBe("2.55.17.97771");
    expect(m.movers).toEqual({ up: [], down: [] }); // identical snapshots → nothing moved
    expect(m.top[0]!.delta).toBe(0);
  });
});
