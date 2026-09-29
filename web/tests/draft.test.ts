import { describe, expect, it } from "vitest";
import type { MatchupsFile } from "../src/data";
import {
  DRAFT_ORDER,
  applyPick,
  available,
  decodeDraft,
  draftState,
  encodeDraft,
  recommend,
  undo,
  type DraftHero,
} from "../src/lib/draft";

// the Storm League order (Heroes Profile's drafter and a recorded draft, #25): A = first-pick team
const EXPECTED = [
  "first ban", "second ban", "first ban", "second ban",
  "first pick", "second pick", "second pick", "first pick", "first pick",
  "second ban", "first ban",
  "second pick", "second pick", "first pick", "first pick", "second pick",
];

const h = (slug: string, name: string, extra: Partial<DraftHero> = {}): DraftHero => ({ slug, name, ko: name, role: "Tank", role_ko: "전사", wrs: 50, wr: 50, games: 1000, maps: {}, ...extra });
const HEROES: DraftHero[] = [
  h("illidan", "Illidan", { wrs: 52 }),
  h("abathur", "Abathur", { wrs: 51 }),
  h("cho", "Cho"),
  h("gall", "Gall"),
  h("uther", "Uther", { wrs: 49 }),
  h("zeratul", "Zeratul"),
];

describe("draft order", () => {
  it("is the 16-step Storm League sequence", () => {
    expect(DRAFT_ORDER.map((s) => `${s.side} ${s.kind}`)).toEqual(EXPECTED);
    expect(DRAFT_ORDER.filter((s) => s.kind === "ban")).toHaveLength(6);
  });

  it("state: whose turn it is and what each team has", () => {
    const s = draftState(["illidan", "abathur", "uther"]);
    expect(s.step).toBe(3);
    expect(s.next).toEqual({ side: "second", kind: "ban" });
    expect(s.first.bans).toEqual(["illidan", "uther"]);
    expect(s.second.bans).toEqual(["abathur"]);
    const done = draftState(Array.from({ length: 16 }, (_, i) => `x${i}`));
    expect(done.next).toBeNull();
    expect(done.first.picks).toHaveLength(5);
    expect(done.second.picks).toHaveLength(5);
  });
});

describe("Cho'gall", () => {
  const bans = ["illidan", "abathur", "uther", "zeratul"];
  it("picking one half puts the other half in the same team's next slot", () => {
    // step 5 is the second team's first of two picks
    const seq = applyPick([...bans, "x"], "cho");
    expect(seq.slice(5)).toEqual(["cho", "gall"]);
    expect(draftState(seq).second.picks).toEqual(["cho", "gall"]);
  });

  it("is not offered where the other half would land on the other team or a ban", () => {
    for (const step of [4, 6, 8, 12, 14, 15]) {
      const seq = Array.from({ length: step }, (_, i) => `x${i}`);
      const names = available(HEROES, seq).map((x) => x.slug);
      expect(names, `step ${step}`).not.toContain("cho");
      expect(names, `step ${step}`).not.toContain("gall");
    }
    for (const step of [5, 7, 11, 13]) {
      const seq = Array.from({ length: step }, (_, i) => `x${i}`);
      expect(available(HEROES, seq).map((x) => x.slug), `step ${step}`).toContain("cho");
    }
  });

  it("undo takes both halves back; banning one half takes both off the board", () => {
    const seq = applyPick([...bans, "x"], "gall");
    expect(undo(seq)).toEqual([...bans, "x"]);
    expect(undo(["illidan"])).toEqual([]);
    const banned = available(HEROES, ["cho"]).map((x) => x.slug);
    expect(banned).not.toContain("gall");
  });
});

describe("available", () => {
  it("drops heroes already banned or picked, and nothing is available once the draft is done", () => {
    expect(available(HEROES, ["illidan", "abathur"]).map((x) => x.slug)).toEqual(["cho", "gall", "uther", "zeratul"]);
    expect(available(HEROES, Array.from({ length: 16 }, (_, i) => `x${i}`))).toEqual([]);
  });
});

describe("recommend", () => {
  const file = (hero: string, win_rate: number, ally: [string, number, number][], enemy: [string, number, number][]): MatchupsFile => ({
    hero, patch: "p", game_type: "sl", collected_at: "t", games: 5000, wins: Math.round(50 * win_rate), win_rate,
    ally: ally.map(([hero, games, wr]) => ({ hero, games, wins: Math.round((games * wr) / 100), win_rate: wr })),
    enemy: enemy.map(([hero, games, wr]) => ({ hero, games, wins: Math.round((games * wr) / 100), win_rate: wr })),
  });
  // Abathur (first team) wins 60 % with Illidan vs his own 50 %; Uther (second team) wins 40 % against Illidan vs his own 50 %
  const matchups = new Map([
    ["abathur", file("Abathur", 50, [["Illidan", 100, 60]], [])],
    ["uther", file("Uther", 50, [], [["Illidan", 900, 40]])],
  ]);
  const heroes = HEROES.map((x) => (x.slug === "illidan" ? { ...x, maps: { "Cursed Hollow": { wr: 55, games: 100 } } } : x));
  const bans = ["zeratul", "cho", "gall", "x1"];

  it("a pick: base + synergy with our picks + counter against theirs + map, each term shown", () => {
    // first team picks at step 7, with Abathur picked by it and Uther by the second team
    const seq = [...bans, "abathur", "uther", "x2"];
    const [top] = recommend(heroes, seq, { matchups, map: "Cursed Hollow" });
    expect(top!.hero.slug).toBe("illidan");
    expect(top!.terms.base).toBeCloseTo(2, 6);
    expect(top!.terms.allies).toBeCloseTo((60 - 50) * (100 / 200), 6); // +5.0
    expect(top!.terms.enemies).toBeCloseTo(-(40 - 50) * (900 / 1000), 6); // +9.0
    expect(top!.terms.map).toBeCloseTo((55 - 50) * (100 / 200), 6); // +2.5
    expect(top!.score).toBeCloseTo(2 + 5 + 9 + 2.5, 6);
  });

  it("a ban: the same score from the other team's side", () => {
    // step 9 is the second team's ban: suggest what the first team (Abathur) would most want
    const seq = [...bans, "abathur", "uther", "x2", "x3", "x4"];
    const [top] = recommend(heroes, seq, { matchups, map: null });
    expect(top!.hero.slug).toBe("illidan");
    expect(top!.terms.allies).toBeCloseTo(5, 6); // with Abathur, on the first team
    expect(top!.terms.enemies).toBeCloseTo(9, 6); // against Uther
    expect(top!.terms.map).toBe(0);
  });

  it("pairs under 50 games and picked heroes without a matchups file add nothing, and say so", () => {
    const thin = new Map([["abathur", file("Abathur", 50, [["Illidan", 49, 90]], [])]]);
    const [top] = recommend(heroes, [...bans, "abathur", "uther", "x2"], { matchups: thin, map: null });
    expect(top!.terms.allies).toBe(0);
    expect(top!.missing).toEqual(["uther"]);
  });
});

describe("share link", () => {
  it("round-trips the first-pick side, the map and the sequence, Cho'gall halves included once", () => {
    const seq = applyPick(["illidan", "abathur", "uther", "zeratul", "x"], "cho");
    const q = encodeDraft({ usFirst: false, map: "Cursed Hollow", seq });
    expect(q).toContain("first=them");
    const back = decodeDraft(q, HEROES);
    expect(back.usFirst).toBe(false);
    expect(back.map).toBe("Cursed Hollow");
    expect(back.seq).toEqual(["illidan", "abathur", "uther", "zeratul"]); // "x" is no hero: the replay stops there
  });

  it("an empty query is a fresh draft with us picking first", () => {
    expect(decodeDraft("", HEROES)).toEqual({ usFirst: true, map: null, seq: [] });
  });
});

describe("draftHeroes (build time)", () => {
  it("takes the tier table's win-rate input and the per-map records from the Storm League snapshot", async () => {
    const { draftHeroes } = await import("../src/lib/draft");
    const row = (hero: string, map: string, wins: number, games: number, extra = {}) => ({
      hero, map, wins, losses: games - wins, games, bans: 0, pick: 10, popularity: 10, win_rate: (wins / games) * 100, ban_rate: 0, ci: null, ...extra,
    });
    const snap = {
      patch: "p", mode: "sl", game_type: "sl", league_tier: null, collected_at: "t", matches: 1,
      rows: [row("Illidan", "all", 550, 1000, { tier_win_rate: 53 }), row("Illidan", "Cursed Hollow", 60, 100)],
    };
    const table = {
      roles: [],
      heroes: [
        { name: "Illidan", slug: "illidan", ko: "일리단", role: "Melee Assassin", role_ko: "근접 암살자", portrait: "img/heroes/illidan.png" },
        { name: "Uther", slug: "uther", ko: "우서", role: "Healer", role_ko: "치유사" },
      ],
    };
    const [illidan, uther] = draftHeroes(snap, table);
    expect(illidan!.wrs).toBeCloseTo(50 + (53 - 50) * (1000 / 1500), 6); // the tier formula's WRs (k=500), party-corrected input
    expect(illidan!.wr).toBeCloseTo(55, 6);
    expect(illidan!.maps["Cursed Hollow"]).toEqual({ wr: 60, games: 100 });
    expect(uther).toMatchObject({ slug: "uther", wrs: 50, games: 0, maps: {} }); // no Storm League games: neutral
  });
});
