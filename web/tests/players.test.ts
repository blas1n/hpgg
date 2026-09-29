import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { HeroTable, MapTable } from "../src/data";
import {
  API_BASE_DEFAULT,
  fetchPlayer,
  modeLabel,
  parseBattletag,
  playerView,
  playersHref,
  REGIONS,
  relativeDay,
  tierKo,
  type PlayerResponse,
} from "../src/lib/players";

const here = dirname(fileURLToPath(import.meta.url));
const json = <T>(rel: string): T => JSON.parse(readFileSync(join(here, rel), "utf-8")) as T;
const heroes = json<HeroTable>("e2e-data/heroes_ko.json");
const maps = json<MapTable>("e2e-data/maps_ko.json");
const zemill = json<PlayerResponse>("fixtures/api_player_zemill.json");

const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": typeof body === "string" ? "text/html" : "application/json", ...headers },
  });

describe("parseBattletag", () => {
  it.each([
    ["Player12#1012", "Player12#1012"],
    ["  Player12#1012 ", "Player12#1012"],
    ["Zemill ＃ 1940", "Player12#1012"],
    ["하늘바람#31234", "하늘바람#31234"],
  ])("%s → %s", (input, out) => expect(parseBattletag(input)).toBe(out));

  it.each(["", "Zemill", "Zemill#", "Zemill#abc", "Ze mill#1234", "#1234", "A".repeat(25) + "#1234"])("rejects %j", (input) => {
    expect(parseBattletag(input)).toBeNull();
  });
});

describe("regions and links", () => {
  it("offers 아시아 (KR) first, then 아메리카 and 유럽", () => {
    expect(REGIONS.map((r) => [r.value, r.label])).toEqual([
      ["KR", "아시아"],
      ["NA", "아메리카"],
      ["EU", "유럽"],
    ]);
  });

  it("builds the page URL with an encoded battletag", () => {
    expect(playersHref()).toBe("/hots/players/");
    expect(playersHref("Player12#1012", "NA")).toBe("/hots/players/?tag=Player12%231012&region=NA");
  });
});

describe("fetchPlayer", () => {
  it("calls the API with the query and returns the profile", async () => {
    const f = vi.fn().mockResolvedValue(res(200, zemill));
    const r = await fetchPlayer("Player12#1012", "NA", { fetchImpl: f, base: "https://api.test" });
    expect(f.mock.calls[0]![0]).toBe("https://api.test/v1/players?battletag=Player12%231012&region=NA");
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.data.player.account_level).toBe(1802);
  });

  it("defaults to the public API host", async () => {
    const f = vi.fn().mockResolvedValue(res(200, zemill));
    await fetchPlayer("Player12#1012", "NA", { fetchImpl: f });
    expect(String(f.mock.calls[0]![0]).startsWith(API_BASE_DEFAULT + "/v1/players?")).toBe(true);
    expect(API_BASE_DEFAULT).toBe("https://api.hpgg.win");
  });

  it.each([
    [404, { error: { code: "player_not_found" } }, {}, "not_found"],
    [429, { error: { code: "quota_exceeded" } }, { "retry-after": "3600" }, "quota"],
    [429, { error: { code: "rate_limited" } }, { "retry-after": "12" }, "rate_limited"],
    [422, { error: { code: "invalid_parameters" } }, {}, "invalid"],
    [503, { error: { code: "upstream_unavailable" } }, {}, "error"],
    [500, { detail: "x" }, {}, "error"],
  ] as const)("HTTP %i → %s", async (status, body, headers, kind) => {
    const r = await fetchPlayer("A#1234", "KR", { fetchImpl: vi.fn().mockResolvedValue(res(status, body, headers)) });
    expect(r.kind).toBe(kind);
    if (r.kind === "quota") expect(r.retryAfter).toBe(3600);
    if (r.kind === "rate_limited") expect(r.retryAfter).toBe(12);
  });

  it("treats a network failure, a timeout or a non-JSON answer (API host not live) as offline", async () => {
    expect((await fetchPlayer("A#1234", "KR", { fetchImpl: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) })).kind).toBe("offline");
    expect((await fetchPlayer("A#1234", "KR", { fetchImpl: vi.fn().mockResolvedValue(res(530, "<html>cloudflare</html>")) })).kind).toBe("offline");
    const hang = vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))));
    expect((await fetchPlayer("A#1234", "KR", { fetchImpl: hang, timeoutMs: 10 })).kind).toBe("offline");
  });

  it("a 200 without a player object is an error, not a crash", async () => {
    const r = await fetchPlayer("A#1234", "KR", { fetchImpl: vi.fn().mockResolvedValue(res(200, { nope: 1 })) });
    expect(r.kind).toBe("error");
  });
});

describe("labels", () => {
  it("translates league names", () => {
    expect(tierKo("Diamond 2")).toBe("다이아몬드 2");
    expect(tierKo("Master")).toBe("마스터");
    expect(tierKo("Grand Master")).toBe("그랜드마스터");
    expect(tierKo("Bronze 5")).toBe("브론즈 5");
    expect(tierKo("Silver 1")).toBe("실버 1");
    expect(tierKo("Gold 3")).toBe("골드 3");
    expect(tierKo("Platinum 4")).toBe("플래티넘 4");
    expect(tierKo("Wood")).toBe("Wood");
    expect(tierKo(null)).toBeNull();
  });

  it("names modes", () => {
    expect(modeLabel("sl")).toBe("폭풍 리그");
    expect(modeLabel("qm")).toBe("빠른 대전");
    expect(modeLabel("ar")).toBe("ARAM");
    expect(modeLabel("xx")).toBe("xx");
    expect(modeLabel(null)).toBe("–");
  });

  it("says how long ago a match was (HP dates are UTC)", () => {
    const now = new Date("2026-09-29T03:00:00Z");
    expect(relativeDay("2026-09-29 02:30:00", now)).toBe("30분 전");
    expect(relativeDay("2026-09-28 20:00:00", now)).toBe("7시간 전");
    expect(relativeDay("2026-09-26 03:00:00", now)).toBe("3일 전");
    expect(relativeDay("2026-08-01 03:00:00", now)).toBe("2026-08-01");
    expect(relativeDay(null, now)).toBe("");
    expect(relativeDay("garbage", now)).toBe("");
  });
});

describe("playerView", () => {
  const now = new Date("2026-09-29T03:00:00Z");
  const v = playerView(zemill, heroes, maps, now);

  it("summarises the account", () => {
    expect(v.name).toBe("Zemill");
    expect(v.tag).toBe("#1940");
    expect(v.regionLabel).toBe("아메리카");
    expect(v.level).toBe(1802);
    expect(v.games).toBe(6684);
    expect(v.winRate).toBe(52.39);
    expect(v.stale).toBe(false);
  });

  it("puts Storm League first with its league in Korean", () => {
    expect(v.modes[0]).toMatchObject({ mode: "sl", label: "폭풍 리그", mmr: 2908, tier: "다이아몬드 2", tierKey: "diamond", games: 93 });
    expect(v.modes.find((m) => m.mode === "qm")?.tierKey).toBe("master");
  });

  it("uses Korean hero names, portraits and hero links", () => {
    expect(v.heroes[0]).toMatchObject({ name: "루시우", slug: "lucio", portrait: "img/heroes/lucio.png", games: 300, winRate: 58.33, href: "/hots/heroes/lucio/" });
    expect(v.bestHeroes[0]!.name).toBe("누더기");
  });

  it("recent matches in Korean with MMR change", () => {
    expect(v.matches).toHaveLength(5);
    expect(v.matches[0]).toMatchObject({ hero: "데커드", slug: "deckard", mode: "폭풍 리그", map: "볼스카야 공장", win: true, mmrChange: 2.58, when: "1일 전" });
    expect(v.recent).toEqual({ wins: 2, losses: 3 });
  });

  it("roles in the heroes_ko order with Korean names", () => {
    expect(v.roles.map((r) => r.label)).toEqual(["전사", "투사", "치유사", "지원가", "근접 암살자", "원거리 암살자"]);
    expect(v.roles[0]!.winRate).toBe(48.52);
  });

  it("maps: Korean names where the game data has them (ARAM maps are not in maps_ko yet)", () => {
    expect(v.maps[0]).toMatchObject({ name: "Braxis Outpost", games: 499 });
    expect(v.maps.map((m) => m.name)).toEqual(["Braxis Outpost", "Silver City", "Lost Cavern"]);
  });

  it("falls back to English names for heroes and maps it does not know, and flags stale data", () => {
    const odd: PlayerResponse = {
      ...zemill,
      stale: true,
      notice: "quota_exceeded",
      player: {
        ...zemill.player,
        win_rate: null,
        heroes_most_played: [{ hero: "Xal'atath", short_name: "xalatath", games: 3, wins: 2, losses: 1, win_rate: 66.67, last_played: null }],
        maps_most_played: [{ map: "New Map", games: 1, wins: 1, losses: 0, win_rate: 100 }],
        recent_matches: [{ replay_id: null, date: null, mode: null, map: null, hero: null, short_name: null, win: false, mmr_change: null }],
        modes: [{ mode: "sl", mmr: null, tier: null, wins: 1, losses: 0, win_rate: null }],
      },
    };
    const w = playerView(odd, heroes, maps, now);
    expect(w.heroes[0]).toMatchObject({ name: "Xal'atath", portrait: undefined, href: null });
    expect(w.maps[0]!.name).toBe("New Map");
    expect(w.matches[0]).toMatchObject({ hero: "–", map: "–", mode: "–", when: "" });
    expect(w.modes[0]).toMatchObject({ tier: null, tierKey: null });
    expect(w.stale).toBe(true);
    expect(w.notice).toBe("quota_exceeded");
    expect(w.fetchedLabel).toMatch(/^09\/29 \d\d:\d\d 기준$/);
  });
});
