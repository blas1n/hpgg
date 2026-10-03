import { describe, expect, it } from "vitest";
import type { HeroTable, HotfixesFile, PatchNotesFile } from "../src/data";
import type { Row, Snapshot } from "../src/formula";
import { patchSummary } from "../src/lib/patchSummary";

// 패치 요약 (owner 2026-10-03, from the Arca feedback "패치노트가 좀 긴데 … 직관적으로 너프,버프"): one page per
// reference patch — what the official notes and the unannounced hotfixes changed, new heroes, and where each changed
// hero stands now against the previous patch. Numbers only; nothing is said about cause.

const hero = (name: string, role = "Tank") => ({ name, slug: name.toLowerCase(), ko: `${name}ko`, en: name, role, role_ko: role, short_name: name.toLowerCase(), portrait: `img/heroes/${name.toLowerCase()}.png` });
const heroes: HeroTable = { roles: [{ name: "Tank", ko: "전사" }], heroes: ["Abathur", "Auriel", "Garrosh", "Qhira", "Xal", "Zeratul", "Valla"].map((n) => hero(n)) };

const row = (hero: string, games: number, wins: number, pick: number): Row => ({ hero, map: "all", wins, losses: games - wins, games, bans: 0, pick, popularity: pick, win_rate: (wins / games) * 100, ban_rate: 0, ci: null, tier_win_rate: (wins / games) * 100 });
const snap = (patch: string, rows: Row[], mode = "qm"): Snapshot => ({ patch, mode, game_type: mode, league_tier: null, region: null, collected_at: "2026-10-02T18:20:24Z", matches: 10000, rows });

const previous = snap("2.55.17", [row("Abathur", 1000, 520, 30), row("Garrosh", 1000, 470, 20), row("Qhira", 1000, 500, 10), row("Zeratul", 1000, 480, 12), row("Auriel", 1000, 510, 15), row("Valla", 1000, 500, 20)]);
const current = snap("2.57.0", [row("Abathur", 1000, 480, 30), row("Garrosh", 1000, 540, 20), row("Qhira", 1000, 500, 10), row("Zeratul", 1000, 560, 12), row("Auriel", 1000, 505, 15), row("Valla", 1000, 500, 20), row("Xal", 1000, 690, 60)]);

const note = (id: string, build: string | null, verdicts: Record<string, "buff" | "nerf" | "mixed">) => ({
  id,
  published: "2026-09-28T17:00:00Z",
  build,
  title: { ko: `패치 노트 ${id}`, en: `Patch notes ${id}` },
  url: { ko: `https://news.blizzard.com/ko-kr/${id}`, en: `https://news.blizzard.com/en-us/${id}` },
  heroes: Object.fromEntries(Object.entries(verdicts).map(([h, verdict]) => [h, { verdict, groups: [] }])),
});
const notes: PatchNotesFile = {
  parser: 1,
  fetched_at: "2026-10-02T03:04:08Z",
  notes: [note("b", "2.57.0.98400", { Garrosh: "nerf" }), note("a", "2.57.0.98285", { Abathur: "nerf", Garrosh: "buff", Qhira: "mixed" }), note("old", "2.55.17.97605", { Valla: "buff" })],
};
const hotfixes: HotfixesFile = {
  builds: [
    { build: "2.57.0.98304", previous: "2.57.0.98297", first_seen: "2026-09-29T21:46:46Z", parser: 1, heroes: { Auriel: [{ kind: "talent", id: "x", ko: "특성", en: "Talent", changes: [] }] } },
    // the build an official note belongs to is the note, not a hotfix
    { build: "2.57.0.98285", previous: "2.55.17.98025", first_seen: "2026-09-28T17:38:57Z", parser: 1, heroes: { Garrosh: [] } },
    { build: "2.55.17.97650", previous: "2.55.17.97605", first_seen: "2026-07-24T17:21:04Z", parser: 1, heroes: { Valla: [] } },
  ],
} as unknown as HotfixesFile;

// Storm League: the same heroes, other numbers — Abathur climbs there while he falls in Quick Match
const slPrevious = snap("2.55.17", previous.rows.map((r) => (r.hero === "Abathur" ? row("Abathur", 1000, 460, 30) : r)), "sl");
const slCurrent = snap("2.57.0", current.rows.map((r) => (r.hero === "Abathur" ? row("Abathur", 1000, 560, 30) : r)), "sl");
const modes = { qm: { snap: current, previous }, sl: { snap: slCurrent, previous: slPrevious } };
const s = patchSummary({ patch: "2.57.0", notes, hotfixes, modes, heroes, minGames: 200, locale: "ko" });
const by = (name: string) => s.rows.find((r) => r.hero.name === name);

describe("patchSummary", () => {
  it("lists the patch's official notes, newest first, in the page language", () => {
    expect(s.notes.map((n) => n.title)).toEqual(["패치 노트 b", "패치 노트 a"]);
    expect(s.notes[0]!.url).toBe("https://news.blizzard.com/ko-kr/b");
  });

  it("compares with the previous patch the snapshots name", () => {
    expect(s.previousPatch).toBe("2.55.17");
  });

  it("takes only this patch: a note or hotfix of 2.55.17 is not in the 2.57.0 summary", () => {
    expect(by("Valla")).toBeUndefined();
  });

  it("a hero buffed in one note and nerfed in the next is 조정 (mixed); one verdict stays as it is", () => {
    expect(by("Garrosh")!.verdict).toBe("mixed");
    expect(by("Abathur")!.verdict).toBe("nerf");
    expect(by("Qhira")!.verdict).toBe("mixed");
  });

  it("a build without a note is a hotfix; the noted build's own changes are not counted twice", () => {
    expect(by("Auriel")).toMatchObject({ verdict: null, hotfix: true });
    expect(by("Garrosh")!.hotfix).toBe(false);
    expect(s.hotfixBuilds).toEqual(["2.57.0.98304"]);
  });

  it("a hero with stats now and none on the previous patch is new", () => {
    expect(by("Xal")).toMatchObject({ isNew: true, verdict: null });
    expect(by("Xal")!.qm).toMatchObject({ prevRank: null, delta: null, rank: 1 });
  });

  it("a hero the patch did not touch is not listed", () => {
    expect(by("Zeratul")).toBeUndefined();
    expect(s.rows).toHaveLength(5);
  });

  it("counts by verdict, hotfix and new", () => {
    expect(s.counts).toEqual({ buff: 0, nerf: 1, mixed: 2, hotfix: 1, new: 1 });
  });

  it("rank and win rate before → after in each mode, from the tier formula on each patch", () => {
    const { qm, sl } = by("Abathur")!;
    expect(qm!.delta).toBe(qm!.prevRank! - qm!.rank!);
    expect(qm!.prevWr).toBeCloseTo(52);
    expect(qm!.wr).toBeCloseTo(48);
    expect(qm!.delta!).toBeLessThan(0);
    expect(sl!.prevWr).toBeCloseTo(46);
    expect(sl!.wr).toBeCloseTo(56);
    expect(sl!.delta!).toBeGreaterThan(0);
  });

  it("new heroes first, then the biggest Quick Match climb to the biggest fall (the larger sample, the site's default)", () => {
    expect(s.rows[0]!.hero.name).toBe("Xal");
    const deltas = s.rows.slice(1).map((r) => r.qm?.delta ?? -Infinity);
    expect(deltas).toEqual([...deltas].sort((x, y) => y - x));
  });

  it("names, per mode, the changed hero that climbed most and the one that fell most", () => {
    expect(s.up.qm?.hero.name).toBe("Garrosh");
    expect(s.down.qm?.hero.name).toBe("Abathur");
    expect(s.up.sl?.hero.name).not.toBe(s.down.sl?.hero.name);
    expect(s.down.sl?.hero.name).not.toBe("Abathur"); // he climbs in Storm League
  });

  it("without a previous patch there is nothing to compare: no ranks before, no climb or fall", () => {
    const first = patchSummary({ patch: "2.57.0", notes, hotfixes, modes: { qm: { snap: current, previous: null }, sl: { snap: slCurrent, previous: null } }, heroes, minGames: 200, locale: "ko" });
    expect(first.previousPatch).toBeNull();
    expect(first.rows.every((r) => r.qm!.prevRank === null && r.qm!.delta === null && r.sl!.delta === null && !r.isNew)).toBe(true);
    expect(first.up).toEqual({ qm: null, sl: null });
    expect(first.down).toEqual({ qm: null, sl: null });
  });

  it("a patch named by one build (data from before x.y.z patches) takes that build's notes and hotfixes", () => {
    const t = patchSummary({ patch: "2.57.0.98304", notes, hotfixes, modes, heroes, minGames: 200, locale: "ko" });
    expect(t.hotfixBuilds).toEqual(["2.57.0.98304"]);
    expect(t.notes).toEqual([]);
  });

  it("only heroes on the site (with assets) are listed", () => {
    const withUnknown = { ...notes, notes: [note("c", "2.57.0.98500", { Nobody: "buff" }), ...notes.notes] };
    const t = patchSummary({ patch: "2.57.0", notes: withUnknown, hotfixes, modes, heroes, minGames: 200, locale: "ko" });
    expect(t.rows.some((r) => r.hero.name === "Nobody")).toBe(false);
  });
});
