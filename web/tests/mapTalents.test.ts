import { describe, expect, it, vi } from "vitest";
import { fetchMapTalents, mapTalentTree, patchLine, type MapTalentsResponse } from "../src/lib/mapTalents";
import type { TalentTable } from "../src/data";

// A hero's talent tree on one map (영웅 상세, owner 2026-11-05): GET /v1/heroes/talents on our API, which asks Heroes
// Profile when the hero, map and bracket are not kept yet (~2 s the first time, server/heroes/talents.py).

const ANSWER: MapTalentsResponse = {
  hero: "Hanzo",
  map: "Battlefield of Eternity",
  tier: "all",
  patch: "2.57.0",
  builds: "2.57.0.98285,2.57.0.98304,2.57.0.98348",
  levels: {
    "1": [
      { talent: "HanzoSimpleGeometry", games: 1151, wins: 545, popularity: 64.81, win_rate: 47.35 },
      { talent: "HanzoRedemption", games: 389, wins: 176, popularity: 21.9, win_rate: 45.24 },
      { talent: "HanzoTargetPractice", games: 236, wins: 95, popularity: 13.29, win_rate: 40.25 },
    ],
    "4": [
      { talent: "HanzoSerratedArrows", games: 1449, wins: 670, popularity: 81.63, win_rate: 46.24 },
      { talent: "HanzoExplosiveArrows", games: 20, wins: 9, popularity: 1.1, win_rate: 45 },
    ],
    "7": [],
  },
  fetched_at: "2026-11-05T09:00:00Z",
  stale: false,
  notice: null,
};

const TABLE: TalentTable = {
  talents: {
    HanzoSimpleGeometry: { ko: "단순 기하학", icon: "a.png", desc: "설명", en: "Simple Geometry", desc_en: "Desc" },
    HanzoSerratedArrows: { ko: "톱니 화살", icon: "b.png" },
    HanzoRedemption: { ko: "속죄", icon: "c.png" },
    HanzoTargetPractice: { ko: "표적 연습", icon: "d.png" },
    HanzoExplosiveArrows: { ko: "폭발 화살", icon: "e.png" },
  },
};

const res = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("map talent tree", () => {
  it("asks our API with the hero, the map and the bracket by HP's names, and the patch", async () => {
    const f = vi.fn(async () => res(200, ANSWER));
    const r = await fetchMapTalents("Hanzo", "Battlefield of Eternity", "high", "2.57.0", { fetchImpl: f });
    expect(r.kind).toBe("ok");
    const url = new URL((f.mock.calls[0] as unknown as [string])[0]);
    expect(url.origin + url.pathname).toBe("https://api.hpgg.win/v1/heroes/talents");
    expect(Object.fromEntries(url.searchParams)).toEqual({ hero: "Hanzo", map: "Battlefield of Eternity", tier: "high", patch: "2.57.0" });
  });

  it("a spent budget, a down server or a wrong answer are not a tree", async () => {
    expect((await fetchMapTalents("Hanzo", "Sky Temple", "all", "2.57.0", { fetchImpl: async () => res(429, { error: { code: "quota_exceeded" } }) })).kind).toBe("quota");
    expect((await fetchMapTalents("Hanzo", "Sky Temple", "all", "2.57.0", { fetchImpl: async () => res(503, { error: { code: "upstream_unavailable" } }) })).kind).toBe("error");
    expect((await fetchMapTalents("Hanzo", "Sky Temple", "all", "2.57.0", { fetchImpl: async () => res(200, { levels: "no" }) })).kind).toBe("error");
    expect((await fetchMapTalents("Hanzo", "Sky Temple", "all", "2.57.0", { fetchImpl: async () => Promise.reject(new Error("down")) })).kind).toBe("offline");
  });

  it("each level: its talents by games, the pick share of the level, the game's names and icons", () => {
    const tree = mapTalentTree(ANSWER, TABLE, "ko");
    expect(tree.levels.map((l) => l.level)).toEqual([1, 4, 7]);
    const one = tree.levels[0]!;
    expect(one.games).toBe(1776);
    expect(one.rows.map((r) => r.name)).toEqual(["단순 기하학", "속죄", "표적 연습"]);
    expect(one.rows[0]).toMatchObject({ talent: "HanzoSimpleGeometry", icon: "a.png", desc: "설명", games: 1151, win_rate: 47.35 });
    expect(one.rows[0]!.pick).toBeCloseTo((1151 / 1776) * 100, 5);
    // the pick bars: the level's most picked talent is the full bar
    expect(one.rows[0]!.share).toBe(1);
    expect(one.rows[2]!.share).toBeCloseTo(236 / 1151, 5);
  });

  it("a talent under 30 games is listed but its win rate is not a finding (the builds' rule)", () => {
    const four = mapTalentTree(ANSWER, TABLE, "ko").levels[1]!;
    expect(four.rows.map((r) => [r.name, r.thin])).toEqual([["톱니 화살", false], ["폭발 화살", true]]);
  });

  it("a level without games is said, not hidden; English pages use the English names", () => {
    const tree = mapTalentTree(ANSWER, TABLE, "en");
    expect(tree.levels[2]).toMatchObject({ level: 7, games: 0, rows: [] });
    expect(tree.levels[0]!.rows[0]).toMatchObject({ name: "Simple Geometry", desc: "Desc" });
  });

  it("a talent the game data lacks keeps HP's id rather than vanishing", () => {
    const tree = mapTalentTree(ANSWER, { talents: {} }, "ko");
    expect(tree.levels[0]!.rows[0]!.name).toBe("HanzoSimpleGeometry");
    expect(tree.levels[0]!.rows[0]!.icon).toBeUndefined();
  });

  it("the server takes a patch, not a build: builds.json from before 2026-10-01 named one build", () => {
    expect(patchLine("2.57.0")).toBe("2.57.0");
    expect(patchLine("2.55.17.98025")).toBe("2.55.17");
  });
});
