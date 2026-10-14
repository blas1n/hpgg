import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { HeroTable } from "../src/data";
import { localizeHeroes } from "../src/i18n/names";
import type { MatchesResponse } from "../src/lib/matches";
import { fetchSeason, qmCard, seasonCard, type SeasonResponse } from "../src/lib/season";

const here = dirname(fileURLToPath(import.meta.url));
const json = <T>(rel: string): T => JSON.parse(readFileSync(join(here, rel), "utf-8")) as T;
const heroes = localizeHeroes(json<HeroTable>("e2e-data/heroes_ko.json"), "ko");
// the server's /v1/players/season for blAs1N#3479 KR, season 34, from HP's answer recorded 2026-10-14
const season = json<SeasonResponse>("fixtures/api_season_blas1n.json");
const games = json<MatchesResponse>("fixtures/api_matches_blas1n.json");
const res = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("fetchSeason", () => {
  it("asks /v1/players/season and reads the answer", async () => {
    const f = vi.fn().mockResolvedValue(res(200, season));
    const r = await fetchSeason("blAs1N#3479", "KR", { fetchImpl: f, base: "https://api.test" });
    expect(f.mock.calls[0]![0]).toBe("https://api.test/v1/players/season?battletag=blAs1N%233479&region=KR");
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.data.heroes).toHaveLength(22);
  });

  it("an answer without heroes is an error, not a card", async () => {
    const f = vi.fn().mockResolvedValue(res(200, { season: 34 }));
    expect((await fetchSeason("blAs1N#3479", "KR", { fetchImpl: f, base: "https://api.test" })).kind).toBe("error");
  });
});

describe("seasonCard (Storm League this season)", () => {
  const c = seasonCard(season.heroes, heroes, "ko");

  it("sums the season: games, record, KDA over the totals, takedowns per game", () => {
    expect([c.games, c.wins, c.losses]).toEqual([66, 41, 25]);
    expect(c.winRate).toBeCloseTo((41 / 66) * 100, 5);
    expect(c.kda).toBeCloseTo((197 + 708) / 175, 5);
    expect(c.takedowns).toBeCloseTo(906 / 66, 5);
  });

  it("lists the heroes most played first, in the page language, with their win rate and KDA", () => {
    expect(c.heroes).toHaveLength(22);
    expect(c.heroes[0]).toMatchObject({ name: "아나", slug: "ana", games: 12, wins: 9, href: "/ko/hots/heroes/ana/" });
    expect(c.heroes[0]!.winRate).toBeCloseTo(75, 5);
    expect(c.heroes[0]!.kda).toBeCloseTo((21 + 179) / 19, 5);
    expect(c.heroes[0]!.perGame).toEqual({ kills: 21 / 12, deaths: 19 / 12, assists: 179 / 12 });
    expect(c.heroes[1]!.name).toBe("알라라크");
  });

  it("averages the game card's stat line per hero over the season (owner 2026-10-14)", () => {
    expect(c.heroes[0]!.stats).toEqual({
      heroDamage: 171806 / 12,
      siegeDamage: 228179 / 12,
      healing: 907905 / 12,
      damageTaken: 235644 / 12,
      experience: 87420 / 12,
    });
    expect(c.heroes[1]!.stats!.healing).toBe(0); // the card then shows damage taken, like a game card
  });

  it("an answer from before the stat line was sent shows no stats, not zeros", () => {
    const old = season.heroes.map(({ hero_damage: _h, siege_damage: _s, healing: _he, damage_taken: _d, experience: _e, ...r }) => r);
    expect(seasonCard(old, heroes, "ko").heroes[0]!.stats).toBeNull();
  });

  it("adds the heroes up by role, every role listed in the game's order, played or not", () => {
    expect(c.roles.map((r) => r.role)).toEqual(heroes.roles.map((r) => r.name));
    const by = Object.fromEntries(c.roles.map((r) => [r.role, r]));
    expect(by.Healer).toMatchObject({ label: "치유사", games: 19, wins: 13 });
    expect(by.Tank).toMatchObject({ games: 4, wins: 0, winRate: 0 });
    expect(by.Support).toMatchObject({ games: 1, wins: 1, winRate: 100 });
  });

  it("no Storm League this season is an empty card", () => {
    const e = seasonCard([], heroes, "ko");
    expect([e.games, e.winRate, e.kda, e.takedowns, e.heroes.length]).toEqual([0, null, null, null, 0]);
    expect(e.roles.every((r) => r.games === 0 && r.winRate === null)).toBe(true);
  });

  it("a hero the site does not know keeps HP's name and no link", () => {
    const odd = seasonCard([{ ...season.heroes[0]!, hero: "Xal'atath", short_name: "xalatath", role: null }], heroes, "ko");
    expect(odd.heroes[0]).toMatchObject({ name: "Xal'atath", slug: null, href: null });
  });

  it("a deathless season's KDA is its takedowns, not infinity", () => {
    const clean = seasonCard([{ ...season.heroes[0]!, deaths: 0 }], heroes, "ko");
    expect(clean.kda).toBe(21 + 179);
  });
});

describe("qmCard (Quick Match, the newest games of the match list)", () => {
  const c = qmCard(games.matches, heroes, "ko");

  it("counts only the Quick Match games and says how many", () => {
    expect([c.games, c.wins, c.losses]).toEqual([25, 11, 14]);
    expect(c.kda).toBeCloseTo((128 + 239) / 95, 5);
    expect(c.takedowns).toBeCloseTo(14.72, 5);
  });

  it("the same heroes and roles as the season card, from the games", () => {
    expect(c.heroes[0]).toMatchObject({ name: "알라라크", games: 9, wins: 4 });
    expect(c.heroes[0]!.kda).toBeCloseTo((43 + 90) / 24, 5);
    // a game without healing (HP sends null for a non-healer) counts as none
    expect(c.heroes[0]!.stats).toEqual({ heroDamage: 411175 / 9, siegeDamage: 516181 / 9, healing: 0, damageTaken: 445185 / 9, experience: 95908 / 9 });
  });

  it("games from the MMR history (no stat line) give the record without KDA", () => {
    const basic = games.matches.map((m) => ({
      ...m,
      kills: null, deaths: null, assists: null, takedowns: null,
      hero_damage: null, siege_damage: null, healing: null, damage_taken: null, experience: null,
    }));
    const b = qmCard(basic, heroes, "ko");
    expect([b.games, b.wins, b.kda, b.takedowns]).toEqual([25, 11, null, null]);
    expect(b.heroes[0]).toMatchObject({ games: 9, kda: null, perGame: null, stats: null });
  });
});
