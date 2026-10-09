import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { HeroTable } from "../src/data";
import { localizeHeroes } from "../src/i18n/names";
import { heroStatsView, type HeroStatsRow } from "../src/lib/heroStats";

const here = dirname(fileURLToPath(import.meta.url));
const json = <T>(rel: string): T => JSON.parse(readFileSync(join(here, rel), "utf-8")) as T;
const heroes = localizeHeroes(json<HeroTable>("e2e-data/heroes_ko.json"), "ko");
// the server's answer for blAs1N#3479 KR (server/players/heroes.py over HP's 2026-10-02 /players/heroes)
const data = json<{ heroes: HeroStatsRow[] }>("fixtures/api_heroes_blas1n.json");
describe("heroStatsView", () => {
  it("the page's hero names, portraits and links; the API's order (most played first)", () => {
    const v = heroStatsView(data.heroes, heroes, "ko");
    expect(v.map((h) => h.name)).toEqual(["알라라크", "첸", "그레이메인"]);
    expect(v[0]).toMatchObject({ slug: "alarak", href: "/ko/hots/heroes/alarak/", games: 9, winRate: 44.44, kda: 5.58 });
    expect(v[0]!.kda).toBe(5.58);
    expect(v[0]!.kills).toBeCloseTo(4.78);
  });
  it("a hero the site does not know keeps the API name and has no link", () => {
    const v = heroStatsView([{ ...data.heroes[0]!, hero: "Newhero", short_name: "newhero" }], heroes, "ko");
    expect(v[0]).toMatchObject({ name: "Newhero", slug: null, href: null });
  });
});
