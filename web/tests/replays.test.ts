import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { AwardTable, HeroTable } from "../src/data";
import { localizeHeroes } from "../src/i18n/names";
import { awardView, fetchReplay, gameLength, replayView, type ReplayResponse } from "../src/lib/replays";

const here = dirname(fileURLToPath(import.meta.url));
const json = <T>(rel: string): T => JSON.parse(readFileSync(join(here, rel), "utf-8")) as T;
const heroes = localizeHeroes(json<HeroTable>("e2e-data/heroes_ko.json"), "ko");
const awards = json<AwardTable>("e2e-data/awards.json");
// our API's answer for Player11#1011's Alarak game (server normalize_replay's shape; numbers synthetic since the shutdown)
const game = json<ReplayResponse>("fixtures/api_replay_78191829.json");
const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("fetchReplay", () => {
  it("asks /v1/replays/<id>", async () => {
    const f = vi.fn().mockResolvedValue(res(200, game));
    const r = await fetchReplay(78191829, { fetchImpl: f, base: "https://api.test" });
    expect(f.mock.calls[0]![0]).toBe("https://api.test/v1/replays/78191829");
    expect(r.kind).toBe("ok");
  });

  it.each([
    [404, { error: { code: "replay_not_found" } }, "not_found"],
    [429, { error: { code: "quota_exceeded" } }, "quota"],
    [200, { replay: null }, "error"],
  ] as const)("HTTP %i → %s", async (status, body, kind) => {
    expect((await fetchReplay(1, { fetchImpl: vi.fn().mockResolvedValue(res(status, body)) })).kind).toBe(kind);
  });
});

describe("awards", () => {
  it("names an award in the page language with its icon; MVP is marked", () => {
    expect(awardView("MVP", awards, "ko")).toEqual({ key: "MVP", name: "MVP", icon: "storm_ui_mvp_mvp_gold.png", mvp: true });
    expect(awardView("MostDamageTaken", awards, "ko")).toMatchObject({ name: "최후의 보루", mvp: false });
    expect(awardView("MostDamageTaken", awards, "en")!.name).toBe("Bulwark");
    expect(awardView(null, awards, "ko")).toBeNull();
    expect(awardView("Nope", awards, "ko")).toBeNull();
    expect(awardView("MVP", null, "ko")).toBeNull();
  });
});

describe("replayView", () => {
  const v = replayView(game.replay, heroes, awards, {}, "ko", "player11#1011"); // any letter case

  it("puts the searched player's team first and marks them", () => {
    expect(v.teams[0]!.win).toBe(true);
    expect(v.teams[0]!.players.some((p) => p.me && p.hero === "알라라크")).toBe(true);
    expect(v.teams.flatMap((t) => t.players).filter((p) => p.me)).toHaveLength(1);
    expect(v.length).toBe("40:00"); // length_s 2400
  });

  it("shows each player's line, award and a link to search them in the same region", () => {
    const me = v.teams[0]!.players.find((p) => p.me)!;
    expect(me).toMatchObject({ name: "Player11", kda: { kills: 2, deaths: 1, assists: 28 }, heroDamage: 55509, experience: 42931 });
    expect(me.award?.name).toBe("MVP");
    expect(me.href).toBe("/ko/hots/players/?tag=Player11%231011&region=KR");
    const thrall = v.teams[1]!.players.find((p) => p.hero === "스랄")!;
    expect(thrall.award?.name).toBe("최후의 보루");
    expect(v.teams[1]!.players.filter((p) => p.party === 0)).toHaveLength(2); // HP's "red" party
    expect(v.teams[0]!.players.every((p) => p.party === null)).toBe(true);
  });

  it("a hero the site does not list keeps its game name and has no portrait", () => {
    const x = v.teams[0]!.players.find((p) => p.hero === "Xal'atath")!;
    expect(x.portrait).toBeUndefined();
  });

  it("when the searched player's team lost, their team still comes first", () => {
    const w = replayView(game.replay, heroes, awards, {}, "ko", "Player24#1024");
    expect(w.teams[0]!.win).toBe(false);
    expect(w.teams[0]!.players.some((p) => p.me)).toBe(true);
  });
});

describe("gameLength", () => {
  it.each([
    [1215, "20:15"],
    [59, "0:59"],
    [null, "–"],
  ] as const)("%s s → %s", (s, out) => expect(gameLength(s)).toBe(out));
});
