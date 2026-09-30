import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { knownOnly } from "../src/lib/known";
import { computeTiers, type Row, type Snapshot } from "../src/formula";
import type { HeroTable, MapTable } from "../src/data";
import { messages } from "../src/i18n/messages";
import { homeModel, mapCards, movers, roleLeaders, topHeroes } from "../src/lib/home";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "e2e-data");
const json = <T>(rel: string): T => JSON.parse(readFileSync(join(dataDir, rel), "utf-8")) as T;
const heroes = json<HeroTable>("heroes_ko.json");
const maps = json<MapTable>("maps_ko.json");
// what the pages see: the e2e stats carry a hero without assets (Xal'atath), dropped by lib/known.ts
const qm = knownOnly(json<Snapshot>("latest/qm.json"), heroes);
const sl = knownOnly(json<Snapshot>("latest/sl.json"), heroes);
const ranked = (rows: Row[]) => computeTiers(rows.filter((r) => r.map === "all"), 200).ranked;

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

  it("keepEmpty (전장 page): every map in the pool, maps without matches last with no heroes", () => {
    const cards = mapCards(sl, maps, heroes, 200, Infinity, { keepEmpty: true });
    expect(cards).toHaveLength(maps.maps.length);
    expect(cards[0]!.slug).toBe("cursed-hollow");
    expect(cards.slice(1).every((c) => c.matches === 0 && c.top.length === 0)).toBe(true);
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
    expect(messages.ko.common.fallbackNote("2.57.0.98285")).toBe("새 패치 2.57.0.98285 표본 쌓는 중");
    expect(messages.en.common.fallbackNote("2.57.0.98285")).toBe("new patch 2.57.0.98285: collecting games");
  });

  it("the tier banner says the new patch is collecting games, without a day count (owner 2026-09-30)", () => {
    expect(messages.ko.tier.bannerPrevious("2.57.0.98304")).toBe("새 패치 2.57.0.98304의 표본을 쌓는 중입니다.");
    expect(messages.ko.tier.bannerThin("2.57.0.98304")).toBe("패치 2.57.0.98304의 표본을 쌓는 중입니다.");
    expect(messages.en.tier.bannerPrevious("2.57.0.98304")).toBe("New patch 2.57.0.98304 is still collecting games.");
    expect(messages.en.tier.bannerThin("2.57.0.98304")).toBe("Patch 2.57.0.98304 is still collecting games.");
  });

  it("carries the previous patch and movers when the previous snapshot exists", () => {
    const m = homeModel("sl", sl, sl, "2.55.17.97771", heroes, 200);
    expect(m.previousPatch).toBe("2.55.17.97771");
    expect(m.movers).toEqual({ up: [], down: [] }); // identical snapshots → nothing moved
    expect(m.top[0]!.delta).toBe(0);
  });
});
