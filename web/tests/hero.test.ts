import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { knownOnly } from "../src/lib/known";
import type { Snapshot } from "../src/formula";
import type { BuildsFile, HeroTable, MapTable, TalentTable } from "../src/data";
import { BUILD_MIN_GAMES, BUILDS_SHOWN, descParts, heroBuilds, heroGrid, heroSummary, mapRows } from "../src/lib/hero";
import { buildBase, buildScore } from "../src/formula";

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

  it("below the sample floor: grey with its games; no game in a collected view: grey with 0 games", () => {
    const thin: Snapshot = { ...qm, rows: qm.rows.map((r) => (r.hero === "Illidan" && r.map === "all" ? { ...r, games: 120 } : r)) };
    expect(heroSummary(thin, null, "Illidan", 200)).toMatchObject({ kind: "grey", games: 120 });
    // KR 다마그 10-02: the file exists, the hero did not play in it — a thin sample, not "no data"
    const without: Snapshot = { ...qm, rows: qm.rows.filter((r) => r.hero !== "Illidan") };
    expect(heroSummary(without, null, "Illidan", 200)).toEqual({ kind: "grey", win_rate: null, games: 0, pick: 0 });
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

describe("mapRows in a thin view (owner 10-02: KR, 표본 부족 and 0판)", () => {
  const cursed = sl.rows.find((r) => r.hero === "Illidan" && r.map === "Cursed Hollow")!;
  const other = sl.rows.find((r) => r.hero !== "Illidan" && r.map === "Cursed Hollow")!;
  const snap: Snapshot = {
    ...sl,
    rows: [
      { ...cursed, games: 300, wins: 150, win_rate: 50 },
      { ...cursed, map: "Towers of Doom", games: 1, wins: 1, win_rate: 100 }, // one game, 100 %
      { ...other, map: "Sky Temple", games: 4 }, // a map of this view where Illidan has no game
    ],
  };
  const rows = mapRows(snap, "Illidan", maps, 200);
  it("a map under the floor never leads the list on a lucky game: solid maps first, then thin ones by games", () => {
    expect(rows.map((r) => r.slug)).toEqual(["cursed-hollow", "towers-of-doom", "sky-temple"]);
    expect(rows.map((r) => r.thin)).toEqual([false, true, true]);
  });
  it("a map of the view where the hero has no game is listed with 0 games and no win rate", () => {
    expect(rows[2]).toMatchObject({ slug: "sky-temple", games: 0, win_rate: null, thin: true });
  });
});

describe("heroGrid", () => {
  it("the hero in every region × bracket the mode has, with tier and rank where ranked; a missing file is an empty cell", () => {
    const cells = {
      all: { all: sl, low: sl, high: null },
      kr: { all: sl, low: null, high: null },
      na: { all: null, low: null, high: null },
      eu: { all: null, low: null, high: null },
    };
    const g = heroGrid("sl", cells, "Illidan", 200);
    expect(g.brackets).toEqual(["all", "low", "high"]);
    expect(g.rows.map((r) => r.region)).toEqual(["all", "kr", "na", "eu"]);
    const all = g.rows[0]!.cells;
    expect(all.map((c) => c.bracket)).toEqual(["all", "low", "high"]);
    expect(all[0]).toMatchObject({ bracket: "all", tier: "A", sample: "ranked" });
    expect(all[0]!.games).toBeGreaterThan(200);
    expect(all[2]).toEqual({ bracket: "high", tier: null, rank: null, n: 0, win_rate: null, games: 0, sample: "uncollected" });
    expect(g.rows[2]!.cells[0]!.win_rate).toBeNull();
  });
  it("a cell under the floor is thin and one without a game is zero, apart from one not collected (owner 10-02)", () => {
    const thin: Snapshot = { ...sl, rows: sl.rows.map((r) => (r.hero === "Illidan" && r.map === "all" ? { ...r, games: 28 } : r)) };
    const without: Snapshot = { ...sl, rows: sl.rows.filter((r) => r.hero !== "Illidan") };
    const none = { all: null, low: null, high: null };
    const g = heroGrid("sl", { all: { all: sl, low: sl, high: sl }, kr: { all: thin, low: without, high: null }, na: none, eu: none }, "Illidan", 200);
    const kr = g.rows[1]!.cells;
    expect(kr[0]).toMatchObject({ sample: "thin", tier: null, games: 28 });
    expect(kr[0]!.win_rate).not.toBeNull();
    expect(kr[1]).toMatchObject({ sample: "zero", tier: null, games: 0, win_rate: null });
    expect(kr[2]).toMatchObject({ sample: "uncollected" });
  });
  it("quick match: regions only", () => {
    const cells = { all: { all: qm, low: null, high: null }, kr: { all: qm, low: null, high: null }, na: { all: null, low: null, high: null }, eu: { all: null, low: null, high: null } };
    const g = heroGrid("qm", cells, "Illidan", 200);
    expect(g.brackets).toEqual(["all"]);
    expect(g.rows.every((r) => r.cells.length === 1)).toBe(true);
  });
});

describe("heroBuilds", () => {
  const high = builds.brackets!.high!.heroes.Illidan!;

  it("joins every build talent with its Korean name, icon and tooltip; English title when the game text is missing", () => {
    const v = heroBuilds(builds, talents, "Illidan", "ko");
    expect(Object.keys(v).sort()).toEqual(["all", "high", "low"]);
    const list = v.high!;
    expect(list).toHaveLength(BUILDS_SHOWN);
    expect(list[0]!.talents).toHaveLength(7);
    expect(list[0]!.talents[0]).toMatchObject({ level: 1, ko: "끝없는 증오" });
    expect(list[0]!.talents[0]!.icon).toMatch(/\.png$/);
    expect(list[0]!.share).toBeCloseTo(list[0]!.games / Math.max(...list.map((b) => b.games)));
    expect(heroBuilds(builds, null, "Illidan", "ko").high![0]!.talents[0]!.ko).toBe("Unending Hatred");
    expect(heroBuilds(builds, talents, "Nobody", "ko")).toEqual({});
    expect(heroBuilds(null, talents, "Illidan", "ko")).toEqual({});
  });

  it("in English: the game's English name, tooltip and cooldown", () => {
    const en = heroBuilds(builds, talents, "Illidan", "en").high!;
    const first = en[0]!.talents[0]!;
    expect(first).toMatchObject({ level: 1, ko: "Unending Hatred" });
    expect(first.icon).toBe(heroBuilds(builds, talents, "Illidan", "ko").high![0]!.talents[0]!.icon);
    const all = en.flatMap((b) => b.talents);
    expect(all.every((t) => !/[\uac00-\ud7a3]/.test(`${t.ko}${t.desc ?? ""}${t.cd ?? ""}`))).toBe(true);
    expect(all.filter((t) => t.desc).length).toBeGreaterThan(all.length / 2);
  });

  // 2026-09-29 design review: right after a patch, builds with 1-3 games printed "100.0%" in bold green
  it("marks builds under the sample floor as thin; their win rate is not a finding", () => {
    const few: BuildsFile = { ...builds, brackets: { high: { league_tier: [5, 6], hero_games: {}, heroes: { Illidan: [{ ...high[0]!, games: 3, win_rate: 100 }, { ...high[1]!, games: BUILD_MIN_GAMES, win_rate: 52 }] } } } };
    const list = heroBuilds(few, talents, "Illidan", "ko").high!;
    expect(list.map((b) => [b.games, b.thin]).sort()).toEqual([[3, true], [BUILD_MIN_GAMES, false]].sort());
    expect(BUILD_MIN_GAMES).toBeGreaterThanOrEqual(20);
    expect(Object.values(heroBuilds(builds, talents, "Illidan", "ko")).flat().every((b) => b.thin === b.games < BUILD_MIN_GAMES)).toBe(true);
  });

  it("pick rate = the build's games / the hero's games in the same bracket; none without that count", () => {
    const v = heroBuilds(builds, null, "Illidan", "ko");
    const n = builds.brackets!.high!.hero_games.Illidan!;
    for (const b of v.high!) expect(b.pick).toBeCloseTo((b.games / n) * 100);
    const bare: BuildsFile = { ...builds, brackets: { high: { ...builds.brackets!.high!, hero_games: {} } } };
    expect(heroBuilds(bare, null, "Illidan", "ko").high!.every((b) => b.pick === null)).toBe(true);
  });
});

describe("heroBuilds 전체 구간 (owner 2026-10-27): the two brackets added up", () => {
  const t = (name: string, level = 1) => ({ level, name, title: name });
  const b = (games: number, win_rate: number, name: string) => ({ games, win_rate, talents: [t(name)] });
  const file: BuildsFile = {
    patch: "p",
    game_type: "sl",
    collected_at: "t",
    brackets: {
      high: { league_tier: [5, 6], hero_games: { X: 1000 }, heroes: { X: [b(100, 60, "A"), b(50, 50, "B")] } },
      low: { league_tier: [1, 2, 3, 4], hero_games: { X: 3000 }, heroes: { X: [b(300, 50, "A"), b(200, 55, "C")] } },
    },
  };

  it("the same seven talents in both brackets are one build: games and wins add up, pick rate over both brackets' games", () => {
    const all = heroBuilds(file, null, "X", "ko").all!;
    const a = all.find((x) => x.talents[0]!.ko === "A")!;
    expect(a.games).toBe(400);
    expect(a.win_rate).toBeCloseTo((100 * 60 + 300 * 50) / 400);
    expect(a.pick).toBeCloseTo((400 / 4000) * 100);
    expect(all.map((x) => x.talents[0]!.ko).sort()).toEqual(["A", "B", "C"]);
  });

  it("no 전체 구간 view unless both brackets have builds", () => {
    const only: BuildsFile = { ...file, brackets: { low: file.brackets!.low! } };
    expect(Object.keys(heroBuilds(only, null, "X", "ko"))).toEqual(["low"]);
  });
});

describe("heroBuilds order (owner 2026-10-26): by the build score, not by games", () => {
  const t = (name: string, level = 1) => ({ level, name, title: name });
  const one = (games: number, win_rate: number, i: number) => ({ games, win_rate, talents: [t(`T${i}`)] });
  const file = (rows: [number, number][]): BuildsFile => ({
    patch: "p",
    game_type: "sl",
    collected_at: "t",
    brackets: { high: { league_tier: [5, 6], hero_games: {}, heroes: { Tyrande: rows.map(([g, w], i) => one(g, w, i)) } } },
  });

  it("sorts by games × (WRs − (hero average − 5)); the printed score decides, ties by games", () => {
    // Tyrande, 다이아+, 2.57.0 (measured 2026-10-26): the popular build stays first, the 63 % one with half the games second
    const rows: [number, number][] = [[158, 48.5], [112, 63.4], [225, 58.0], [99, 53.6], [74, 59.0]];
    const got = heroBuilds(file(rows), null, "Tyrande", "ko").high!;
    const base = buildBase(rows.map(([games, win_rate]) => ({ games, win_rate })));
    const want = [...rows].sort((a, b) => buildScore(b[0], b[1], base) - buildScore(a[0], a[1], base)).map((r) => r[0]);
    expect(got.map((b) => b.games)).toEqual(want);
    expect(got.map((b) => b.games).slice(0, 2)).toEqual([225, 112]);
    expect(got).toHaveLength(BUILDS_SHOWN);
  });

  it("a weak hero's most played build does not sink below rare ones (the reference is the hero's own average, not 50)", () => {
    const rows: [number, number][] = [[900, 45.0], [60, 47.0], [50, 46.0]];
    expect(heroBuilds(file(rows), null, "Tyrande", "ko").high![0]!.games).toBe(900);
  });
});

describe("heroBuilds file format", () => {
  it("a builds file from before the brackets (one QM + SL list) shows no builds rather than mislabelled ones", () => {
    const legacy = { patch: "p", game_type: "qm,sl", collected_at: "t", heroes: { Illidan: builds.brackets!.high!.heroes.Illidan! } } as unknown as BuildsFile;
    expect(heroBuilds(legacy, null, "Illidan", "ko")).toEqual({});
  });
});

describe("descParts", () => {
  it("splits {{…}} markers into highlighted parts and never keeps the braces", () => {
    expect(descParts("매초 {{22}}의 피해, {{4}}초", "ko")).toEqual([
      { text: "매초 ", hl: false },
      { text: "22", hl: true },
      { text: "의 피해, ", hl: false },
      { text: "4", hl: true },
      { text: "초", hl: false },
    ]);
    expect(descParts(undefined, "ko")).toEqual([{ text: "설명이 아직 없습니다.", hl: false }]);
    expect(descParts(undefined, "en")).toEqual([{ text: "No description yet.", hl: false }]);
  });
});
