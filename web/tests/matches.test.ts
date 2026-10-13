import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { AwardTable, HeroTable, MapTable, TalentTable } from "../src/data";
import { localizeHeroes, localizeMaps } from "../src/i18n/names";
import { BRIEFING_GAMES, briefing, fetchMatches, matchRows, type MatchesResponse } from "../src/lib/matches";

const here = dirname(fileURLToPath(import.meta.url));
const json = <T>(rel: string): T => JSON.parse(readFileSync(join(here, rel), "utf-8")) as T;
const heroes = localizeHeroes(json<HeroTable>("e2e-data/heroes_ko.json"), "ko");
const maps = localizeMaps(json<MapTable>("e2e-data/maps_ko.json"), "ko");
// API answer recorded from the local server against live HP, 2026-10-01 (blAs1N#3479 KR, newest 25 of 39)
const full = json<MatchesResponse>("fixtures/api_matches_blas1n.json");
const basic: MatchesResponse = {
  ...full,
  source: "basic",
  matches: full.matches.map((m) => ({
    ...m,
    level: null, kills: null, deaths: null, assists: null, takedowns: null, hero_damage: null, siege_damage: null,
    structure_damage: null, healing: null, self_healing: null, damage_taken: null, experience: null,
    time_spent_dead: null, time_cc: null, merc_camps: null, first_to_ten: null, talents: [],
  })),
};
const alarak: TalentTable = {
  talents: { AlarakOverwhelmingPowerDiscordStrike: { ko: "압도적인 힘", icon: "storm_ui_icon_alarak_discordstrike.png" } as TalentTable["talents"][string] },
};
const res = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("fetchMatches", () => {
  it("asks /v1/players/matches and reads the answer", async () => {
    const f = vi.fn().mockResolvedValue(res(200, full));
    const r = await fetchMatches("blAs1N#3479", "KR", { fetchImpl: f, base: "https://api.test" });
    expect(f.mock.calls[0]![0]).toBe("https://api.test/v1/players/matches?battletag=blAs1N%233479&region=KR");
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.data.matches).toHaveLength(25);
  });

  it.each([
    [404, { error: { code: "player_not_found" } }, "not_found"],
    [403, { error: { code: "player_private" } }, "private"],
    [429, { error: { code: "quota_exceeded" } }, "quota"],
    [503, { error: { code: "upstream_unavailable" } }, "error"],
    [200, { matches: "nope" }, "error"],
  ] as const)("HTTP %i → %s", async (status, body, kind) => {
    const r = await fetchMatches("A#1234", "KR", { fetchImpl: vi.fn().mockResolvedValue(res(status, body)) });
    expect(r.kind).toBe(kind);
  });
});

describe("briefing (the newest games)", () => {
  const b = briefing(full.matches, heroes, "ko");

  it("covers the newest BRIEFING_GAMES games", () => {
    expect(BRIEFING_GAMES).toBe(20);
    expect(b.games).toBe(20);
    expect([b.wins, b.losses]).toEqual([9, 11]);
    expect(b.winRate).toBeCloseTo(45);
  });

  it("averages the stat lines and takes KDA over the totals", () => {
    expect(b.kda).toBeCloseTo((97 + 191) / 69, 2);
    expect(b.avg?.kills).toBeCloseTo(97 / 20);
    expect(b.avg?.heroDamage).toBeCloseTo(48691.65);
    expect(b.avg?.healing).toBeCloseTo(50595.67, 1); // only games where the hero healed
  });

  it("names the heroes played most, with their record", () => {
    expect(b.heroes.map((h) => h.name)).toEqual(["알라라크", "레이너", "실바나스"]);
    expect(b.heroes[0]).toMatchObject({ games: 9, wins: 4, losses: 5 });
    expect(b.heroes[0]!.kda).not.toBeNull();
  });

  it("splits the games by role in the game's own role names", () => {
    expect(b.roles[0]).toMatchObject({ role: "Melee Assassin", games: 10 });
    expect(b.roles.reduce((n, r) => n + r.games, 0)).toBe(20);
    expect(b.roles[0]!.label).toBe(heroes.roles.find((r) => r.name === "Melee Assassin")!.ko);
  });

  it("draws the MMR of the most played mode, oldest first, over every loaded game", () => {
    expect(b.mmr.mode).toBe("qm");
    expect(b.mmr.points).toHaveLength(25);
    expect(b.mmr.points.at(-1)!.mmr).toBe(2342);
    expect(b.mmr.points[0]!.date < b.mmr.points.at(-1)!.date).toBe(true);
  });

  it("from the MMR history alone: record, heroes, roles and MMR, no stat averages", () => {
    const bb = briefing(basic.matches, heroes, "ko");
    expect([bb.wins, bb.losses]).toEqual([9, 11]);
    expect(bb.kda).toBeNull();
    expect(bb.avg).toBeNull();
    expect(bb.heroes[0]!.kda).toBeNull();
    expect(bb.mmr.points).toHaveLength(25);
  });
});

describe("matchRows", () => {
  const rows = matchRows(full.matches, heroes, maps, { alarak }, "ko", new Date("2026-10-01T06:00:00Z"));

  it("shows each game with its stat line in the page language", () => {
    const m = rows[0]!;
    expect(m).toMatchObject({ hero: "알라라크", slug: "alarak", win: true, mode: "빠른 대전", mmrChange: 43.05, level: 22 });
    expect(m.map).toBe(maps.maps.find((x) => x.name === "Hanamura Temple")?.ko ?? "Hanamura Temple");
    expect(m.kda).toEqual({ kills: 9, deaths: 1, assists: 25, ratio: 34, perfect: false });
    expect(m.stats?.heroDamage).toBe(72367);
    expect(m.when).toMatch(/시간 전/);
  });

  it("puts the seven talents in level order, named and with icons once the hero's talents are loaded", () => {
    const t = rows[0]!.talents;
    expect(t.map((x) => x.level)).toEqual([1, 4, 7, 10, 13, 16, 20]);
    expect(t[0]).toMatchObject({ name: "압도적인 힘", icon: "storm_ui_icon_alarak_discordstrike.png" });
    expect(t[1]!.icon).toBeUndefined(); // not in the stub table: no icon, never a broken image
    expect(rows[1]!.talents[0]!.name).toBeNull(); // Leoric's talents not loaded
  });

  it("names the end-of-match award once the award table is loaded", () => {
    const awards = json<AwardTable>("e2e-data/awards.json");
    const withAward = { ...full.matches[0]!, award: "MVP" };
    const [m] = matchRows([withAward, full.matches[1]!], heroes, maps, {}, "ko", new Date(), awards);
    expect(m!.award).toMatchObject({ name: "MVP", mvp: true });
    expect(matchRows([withAward], heroes, maps, {}, "ko")[0]!.award).toBeNull(); // table not loaded yet
    expect(matchRows([full.matches[1]!], heroes, maps, {}, "ko", new Date(), awards)[0]!.award).toBeNull();
  });

  it("a perfect game's KDA is the takedowns, not infinity", () => {
    const [m] = matchRows([{ ...full.matches[0]!, deaths: 0 }], heroes, maps, {}, "ko");
    expect(m!.kda?.ratio).toBe(34);
    expect(m!.kda?.perfect).toBe(true);
  });

  it("rows from the MMR history carry no stat line and no talents", () => {
    const [m] = matchRows(basic.matches, heroes, maps, {}, "ko");
    expect(m!.kda).toBeNull();
    expect(m!.stats).toBeNull();
    expect(m!.talents).toEqual([]);
    expect(m!.win).toBe(true);
  });
});
