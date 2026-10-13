import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { HeroTable, IdentityStats, MapTable } from "../src/data";
import { en } from "../src/i18n/en";
import { ko } from "../src/i18n/ko";
import { localizeHeroes, localizeMaps } from "../src/i18n/names";
import { IDENTITY_STATS, identityOf, identityValue } from "../src/lib/identity";
import { matchRows, type MatchesResponse, type MatchRow } from "../src/lib/matches";

// 영웅별 주요 스탯 (owner 2026-10-12): the stats a hero stands out on (data/identity_stats.json, collector/identity_stats.py),
// shown on each game card with how the game compares with the hero's average.
const here = dirname(fileURLToPath(import.meta.url));
const json = <T>(rel: string): T => JSON.parse(readFileSync(join(here, rel), "utf-8")) as T;
const full = json<MatchesResponse>("fixtures/api_matches_blas1n.json");
const table: IdentityStats = {
  collected_at: "2026-10-12T18:25:00Z",
  since: "2026-09-14",
  games: 6835,
  heroes: {
    Alarak: {
      games: 564,
      stats: [
        { stat: "silences", avg: 40, ratio: 11.8 },
        { stat: "self_healing", avg: 30000, ratio: 1.9 },
      ],
    },
  },
};
const alarak: MatchRow = { ...full.matches.find((m) => m.hero === "Alarak")!, silences: 48, self_healing: 0 };

describe("identityOf", () => {
  it("the hero's stats in the file's order, each against the hero's average", () => {
    expect(identityOf(alarak, table)).toEqual([
      { stat: "silences", value: 48, vs: 20 },
      { stat: "self_healing", value: 0, vs: -100 },
    ]);
  });

  it("nothing for a hero without any, a basic row, an answer from before the fields, or no table yet", () => {
    expect(identityOf({ ...alarak, hero: "Cassia" }, table)).toEqual([]);
    expect(identityOf({ ...alarak, silences: null, self_healing: null }, table)).toEqual([]);
    const { silences: _s, self_healing: _t, ...older } = alarak;
    expect(identityOf(older as MatchRow, table)).toEqual([]);
    expect(identityOf(alarak, null)).toEqual([]);
  });

  it("no comparison against an average of zero", () => {
    const zero: IdentityStats = { ...table, heroes: { Alarak: { games: 564, stats: [{ stat: "silences", avg: 0, ratio: 2 }] } } };
    expect(identityOf(alarak, zero)).toEqual([{ stat: "silences", value: 48, vs: null }]);
  });

  it("a stat the page does not know (a newer collector) is skipped", () => {
    const newer = { ...table, heroes: { Alarak: { games: 564, stats: [{ stat: "dva_matrix", avg: 5, ratio: 3 }] } } } as unknown as IdentityStats;
    expect(identityOf(alarak, newer)).toEqual([]);
  });
});

describe("identityValue", () => {
  it("times as m:ss, the rest as whole numbers", () => {
    expect(identityValue("stuns", 12.4, "ko")).toBe("0:12");
    expect(identityValue("roots", 107, "ko")).toBe("1:47");
    expect(identityValue("self_healing", 14450, "ko")).toBe("14,450");
    expect(identityValue("clutch_heals", 3, "en")).toBe("3");
  });
});

describe("labels", () => {
  it("only what the card's numbers do not show (owner 2026-10-13)", () => {
    expect([...IDENTITY_STATS].sort()).toEqual(["clutch_heals", "roots", "self_healing", "shields", "silences", "stuns"]);
  });

  it("every stat has a name in both languages", () => {
    for (const s of IDENTITY_STATS) {
      expect(ko.players.games.identity.stat[s]).toBeTruthy();
      expect(en.players.games.identity.stat[s]).toBeTruthy();
    }
  });
});

describe("matchRows", () => {
  it("carries the identity stats on the game it belongs to", () => {
    const heroes = localizeHeroes(json<HeroTable>("e2e-data/heroes_ko.json"), "ko");
    const maps = localizeMaps(json<MapTable>("e2e-data/maps_ko.json"), "ko");
    const [m] = matchRows([alarak], heroes, maps, {}, "ko", new Date(), null, table);
    expect(m!.identity.map((x) => x.stat)).toEqual(["silences", "self_healing"]);
    expect(matchRows([alarak], heroes, maps, {}, "ko")[0]!.identity).toEqual([]);
  });
});
