import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { knownOnly } from "../src/lib/known";
import type { Snapshot } from "../src/formula";
import type { BuildsFile, HeroTable, MapTable, TalentTable } from "../src/data";
import { BUILD_MIN_GAMES, bracketRows, descParts, heroBuilds, heroSummary, mapRows } from "../src/lib/hero";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "e2e-data");
const json = <T>(rel: string): T => JSON.parse(readFileSync(join(dataDir, rel), "utf-8")) as T;
const maps = json<MapTable>("maps_ko.json");
const heroes = json<HeroTable>("heroes_ko.json");
// what the pages see: the e2e stats carry a hero without assets (Xal'atath), dropped by lib/known.ts
const qm = knownOnly(json<Snapshot>("latest/qm.json"), heroes);
const sl = knownOnly(json<Snapshot>("latest/sl.json"), heroes);
const qmPrev = json<Snapshot>("previous/qm.json");
const builds = json<BuildsFile>("latest/builds.json");
const talents = json<TalentTable>("talents/illidan.json");

describe("heroSummary", () => {
  it("ranked hero: tier, rank, win rate, games, pick; delta 0 against an identical previous patch", () => {
    const s = heroSummary(qm, qmPrev, "Illidan", 200);
    expect(s.kind).toBe("ranked");
    if (s.kind !== "ranked") return;
    expect(s.tier).toBe("B");
    expect(s.delta).toBe(0);
    expect(s.prevRank).toBe(s.rank);
    expect(s.games).toBeGreaterThan(200);
    expect(s.win_rate).toBeGreaterThan(0);
  });

  it("uses the mode's own snapshot (Storm League: A)", () => {
    const s = heroSummary(sl, null, "Illidan", 200);
    expect(s.kind === "ranked" && s.tier).toBe("A");
    expect(s.kind === "ranked" && s.delta).toBeNull();
    expect(s.kind === "ranked" && s.hasPrevious).toBe(false);
  });

  it("unranked on the previous patch: delta null but hasPrevious true", () => {
    const prev: Snapshot = { ...qmPrev, rows: qmPrev.rows.filter((r) => r.hero !== "Illidan") };
    const s = heroSummary(qm, prev, "Illidan", 200);
    expect(s.kind === "ranked" && s.delta).toBeNull();
    expect(s.kind === "ranked" && s.hasPrevious).toBe(true);
  });

  it("below the sample floor: grey with its games; absent: none", () => {
    const thin: Snapshot = { ...qm, rows: qm.rows.map((r) => (r.hero === "Illidan" && r.map === "all" ? { ...r, games: 120 } : r)) };
    expect(heroSummary(thin, null, "Illidan", 200)).toMatchObject({ kind: "grey", games: 120 });
    expect(heroSummary(qm, null, "Nobody", 200)).toEqual({ kind: "none" });
  });
});

describe("mapRows", () => {
  it("real maps only, best win rate first, thin rows flagged", () => {
    const rows = mapRows(sl, "Illidan", maps, 200);
    expect(rows.map((r) => r.slug)).toEqual(["cursed-hollow"]); // the SL fixture has one real map
    expect(rows[0]!.ko).toBe("저주받은 골짜기");
    expect(rows[0]!.thin).toBe(rows[0]!.games < 200);
    const two = mapRows({ ...sl, rows: [...sl.rows, { ...sl.rows.find((r) => r.hero === "Illidan" && r.map === "Cursed Hollow")!, map: "Towers of Doom", win_rate: 99 }] }, "Illidan", maps, 200);
    expect(two[0]!.name).toBe("Towers of Doom");
  });
});

describe("bracketRows", () => {
  it("one row per published bracket with its tier and rank; missing files are skipped", () => {
    const rows = bracketRows([{ key: "low", snap: sl }, { key: "high", snap: null }], "Illidan", 200);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "low", label: "브론즈 – 플래티넘", tier: "A" });
    expect(rows[0]!.rank).toBeGreaterThan(0);
  });
});

describe("heroBuilds", () => {
  it("joins every build talent with its Korean name, icon and tooltip; English title when the game text is missing", () => {
    const list = heroBuilds(builds, talents, "Illidan");
    expect(list).toHaveLength(5);
    expect(list[0]!.talents).toHaveLength(7);
    expect(list[0]!.talents[0]).toMatchObject({ level: 1, ko: "끝없는 증오" });
    expect(list[0]!.talents[0]!.icon).toMatch(/\.png$/);
    expect(list[0]!.share).toBeCloseTo(list[0]!.games / Math.max(...list.map((b) => b.games)));
    const bare = heroBuilds(builds, null, "Illidan");
    expect(bare[0]!.talents[0]!.ko).toBe("Unending Hatred");
    expect(heroBuilds(builds, talents, "Nobody")).toEqual([]);
    expect(heroBuilds(null, talents, "Illidan")).toEqual([]);
  });

  // 2026-09-29 design review: right after a patch, builds with 1-3 games printed "100.0%" in bold green
  it("marks builds under the sample floor as thin; their win rate is not a finding", () => {
    const hero = builds.heroes.Illidan!;
    const few: BuildsFile = { ...builds, heroes: { Illidan: [{ ...hero[0]!, games: 3, win_rate: 100 }, { ...hero[1]!, games: BUILD_MIN_GAMES, win_rate: 52 }] } };
    const list = heroBuilds(few, talents, "Illidan");
    expect(list.map((b) => b.thin)).toEqual([true, false]);
    expect(BUILD_MIN_GAMES).toBeGreaterThanOrEqual(20);
    expect(heroBuilds(builds, talents, "Illidan").every((b) => b.thin === b.games < BUILD_MIN_GAMES)).toBe(true);
  });
});

describe("descParts", () => {
  it("splits {{…}} markers into highlighted parts and never keeps the braces", () => {
    expect(descParts("매초 {{22}}의 피해, {{4}}초")).toEqual([
      { text: "매초 ", hl: false },
      { text: "22", hl: true },
      { text: "의 피해, ", hl: false },
      { text: "4", hl: true },
      { text: "초", hl: false },
    ]);
    expect(descParts(undefined)).toEqual([{ text: "설명이 아직 없습니다.", hl: false }]);
  });
});
