import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { HeroTable, MapTable } from "../src/data";
import { localizeHeroes, localizeMaps } from "../src/i18n/names";
import {
  API_BASE_DEFAULT,
  fetchPlayer,
  modeLabel,
  parseBattletag,
  playerView,
  playersHref,
  REGIONS,
  relativeDay,
  tierLabel,
  type PlayerResponse,
  defaultRegion,
  readStoredRegion,
  regionFromTimeZone,
  rememberRegion,
  REGION_KEY,
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
    ["Zemill#1940", "Zemill#1940"],
    ["  Zemill#1940 ", "Zemill#1940"],
    ["Zemill ＃ 1940", "Zemill#1940"],
    ["하늘바람#31234", "하늘바람#31234"],
  ])("%s → %s", (input, out) => expect(parseBattletag(input)).toBe(out));

  it.each(["", "Zemill", "Zemill#", "Zemill#abc", "Ze mill#1234", "#1234", "A".repeat(25) + "#1234"])("rejects %j", (input) => {
    expect(parseBattletag(input)).toBeNull();
  });
});

describe("regions and links", () => {
  it("offers 아시아 (KR) first, then 아메리카 and 유럽", () => {
    expect(REGIONS).toEqual(["KR", "NA", "EU"]);
  });

  it("builds the page URL with an encoded battletag, in the page language", () => {
    expect(playersHref("ko")).toBe("/ko/hots/players/");
    expect(playersHref("ko", "Zemill#1940", "NA")).toBe("/ko/hots/players/?tag=Zemill%231940&region=NA");
    expect(playersHref("en", "Zemill#1940", "NA")).toBe("/en/hots/players/?tag=Zemill%231940&region=NA");
  });
});

describe("fetchPlayer", () => {
  it("calls the API with the query and returns the profile", async () => {
    const f = vi.fn().mockResolvedValue(res(200, zemill));
    const r = await fetchPlayer("Zemill#1940", "NA", { fetchImpl: f, base: "https://api.test" });
    expect(f.mock.calls[0]![0]).toBe("https://api.test/v1/players?battletag=Zemill%231940&region=NA");
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.data.player.account_level).toBe(1802);
  });

  it("defaults to the public API host", async () => {
    const f = vi.fn().mockResolvedValue(res(200, zemill));
    await fetchPlayer("Zemill#1940", "NA", { fetchImpl: f });
    expect(String(f.mock.calls[0]![0]).startsWith(API_BASE_DEFAULT + "/v1/players?")).toBe(true);
    expect(API_BASE_DEFAULT).toBe("https://api.hpgg.win");
  });

  it.each([
    [404, { error: { code: "player_not_found" } }, {}, "not_found"],
    [403, { error: { code: "player_private" } }, {}, "private"],
    [403, { error: { code: "forbidden" } }, {}, "error"],
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
    expect(tierLabel("Diamond 2", "ko")).toBe("다이아몬드 2");
    expect(tierLabel("Master", "ko")).toBe("마스터");
    expect(tierLabel("Grand Master", "ko")).toBe("그랜드마스터");
    expect(tierLabel("Bronze 5", "ko")).toBe("브론즈 5");
    expect(tierLabel("Silver 1", "ko")).toBe("실버 1");
    expect(tierLabel("Gold 3", "ko")).toBe("골드 3");
    expect(tierLabel("Platinum 4", "ko")).toBe("플래티넘 4");
    expect(tierLabel("Wood", "ko")).toBe("Wood");
    expect(tierLabel(null, "ko")).toBeNull();
    expect(tierLabel("Diamond 2", "en")).toBe("Diamond 2");
    expect(tierLabel("grand master 1", "en")).toBe("Grand Master 1");
  });

  // #10: "일반 대전" and "ARAM" were guesses. The game's Korean names: Unranked Draft = 일반 선발전 (Blizzard news
  // 2016-06-01 "일반 선발전과 등급전 개편 관련 정보"), ARAM = 무작위 영웅 대전 (patch notes 2020-09-10).
  it("names modes as the game does", () => {
    expect(modeLabel("sl", "ko")).toBe("폭풍 리그");
    expect(modeLabel("qm", "ko")).toBe("빠른 대전");
    expect(modeLabel("ud", "ko")).toBe("일반 선발전");
    expect(modeLabel("ar", "ko")).toBe("무작위 영웅 대전");
    expect(modeLabel("ud", "en")).toBe("Unranked Draft");
    expect(modeLabel("ar", "en")).toBe("ARAM");
    expect(modeLabel("xx", "ko")).toBe("xx");
    expect(modeLabel(null, "ko")).toBe("–");
  });

  it("says how long ago a match was (HP dates are UTC)", () => {
    const now = new Date("2026-09-29T03:00:00Z");
    expect(relativeDay("2026-09-29 02:30:00", "ko", now)).toBe("30분 전");
    expect(relativeDay("2026-09-28 20:00:00", "ko", now)).toBe("7시간 전");
    expect(relativeDay("2026-09-26 03:00:00", "ko", now)).toBe("3일 전");
    expect(relativeDay("2026-08-01 03:00:00", "ko", now)).toBe("2026-08-01");
    expect(relativeDay(null, "ko", now)).toBe("");
    expect(relativeDay("garbage", "ko", now)).toBe("");
    expect(relativeDay("2026-09-29 02:30:00", "en", now)).toBe("30 min ago");
    expect(relativeDay("2026-09-29 02:00:00", "en", now)).toBe("1 hour ago");
    expect(relativeDay("2026-09-26 03:00:00", "en", now)).toBe("3 days ago");
  });
});

describe("playerView", () => {
  const now = new Date("2026-09-29T03:00:00Z");
  const v = playerView(zemill, heroes, maps, "ko", now);

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
    expect(v.heroes[0]).toMatchObject({ name: "루시우", slug: "lucio", portrait: "img/heroes/lucio.png", games: 300, winRate: 58.33, href: "/ko/hots/heroes/lucio/" });
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

  it("maps: Korean names, ARAM maps included (#10)", () => {
    expect(v.maps[0]).toMatchObject({ name: "브락시스 전초기지", games: 499 });
    expect(v.maps.map((m) => m.name)).toEqual(["브락시스 전초기지", "은빛 도시", "잃어버린 동굴"]);
    expect(v.modes.find((m) => m.mode === "ud")?.label).toBe("일반 선발전");
    expect(v.modes.find((m) => m.mode === "ar")?.label).toBe("무작위 영웅 대전");
  });

  it("in English: English names, labels and links under /en", () => {
    const e = playerView(zemill, localizeHeroes(heroes, "en"), localizeMaps(maps, "en"), "en", now);
    expect(e.regionLabel).toBe("Americas");
    expect(e.modes[0]).toMatchObject({ label: "Storm League", tier: "Diamond 2" });
    expect(e.heroes[0]).toMatchObject({ name: "Lúcio", href: "/en/hots/heroes/lucio/" });
    expect(e.matches[0]).toMatchObject({ hero: "Deckard", mode: "Storm League", map: "Volskaya Foundry", when: "1 day ago" });
    expect(e.maps.map((m) => m.name)).toEqual(["Braxis Outpost", "Silver City", "Lost Cavern"]);
    expect(e.roles[0]!.label).toBe("Tank");
    expect(e.fetchedLabel).toMatch(/^as of 09\/29 \d\d:\d\d KST$/);
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
    const w = playerView(odd, heroes, maps, "ko", now);
    expect(w.heroes[0]).toMatchObject({ name: "Xal'atath", portrait: undefined, href: null });
    expect(w.maps[0]!.name).toBe("New Map");
    expect(w.matches[0]).toMatchObject({ hero: "–", map: "–", mode: "–", when: "" });
    expect(w.modes[0]).toMatchObject({ tier: null, tierKey: null });
    expect(w.stale).toBe(true);
    expect(w.notice).toBe("quota_exceeded");
    expect(w.fetchedLabel).toMatch(/^09\/29 \d\d:\d\d 기준$/);
  });
});

describe("default region for player search (owner 2026-10-04: English visitors, and EU ones)", () => {
  it("guesses from the browser's time zone: Europe/Africa → EU, the Americas and Oceania → NA (Oceania plays on the Americas server), Asia → KR", () => {
    expect(regionFromTimeZone("Europe/Berlin")).toBe("EU");
    expect(regionFromTimeZone("Africa/Cairo")).toBe("EU");
    expect(regionFromTimeZone("America/New_York")).toBe("NA");
    expect(regionFromTimeZone("Australia/Sydney")).toBe("NA");
    expect(regionFromTimeZone("Pacific/Auckland")).toBe("NA");
    expect(regionFromTimeZone("Asia/Seoul")).toBe("KR");
    expect(regionFromTimeZone("UTC")).toBeNull();
    expect(regionFromTimeZone(undefined)).toBeNull();
  });

  it("a region the visitor chose before wins, then the time zone, then the page language", () => {
    expect(defaultRegion({ stored: "EU", timeZone: "America/Chicago", locale: "en" })).toBe("EU");
    expect(defaultRegion({ stored: null, timeZone: "Europe/Paris", locale: "en" })).toBe("EU");
    expect(defaultRegion({ stored: null, timeZone: "UTC", locale: "en" })).toBe("NA");
    expect(defaultRegion({ stored: null, timeZone: undefined, locale: "ko" })).toBe("KR");
  });

  it("remembers the last region searched; storage that throws or holds junk is ignored", () => {
    const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    (globalThis as { localStorage?: unknown }).localStorage = ls;
    expect(readStoredRegion()).toBeNull();
    rememberRegion("EU");
    expect(readStoredRegion()).toBe("EU");
    store.set(REGION_KEY, "XX");
    expect(readStoredRegion()).toBeNull();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readStoredRegion()).toBeNull();
    expect(() => rememberRegion("NA")).not.toThrow();
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
});
