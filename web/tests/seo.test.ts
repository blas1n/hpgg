import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { forwarders } from "../scripts/forwarders";
import { messages } from "../src/i18n/messages";
import { NAVER_SITE_VERIFICATION } from "../src/i18n/locales";
import { rootMetadata } from "../src/routes/root";
import type { HeroTable, MapTable } from "../src/data";

// Owner 2026-10-28: titles carry what each language searches for — Korean "히오스 발라 빌드", English "valla build
// hots" — instead of one translated pattern. Naver Search Advisor verifies https://hpgg.win/ with a meta tag.

const here = dirname(fileURLToPath(import.meta.url));
const json = <T>(p: string): T => JSON.parse(readFileSync(p, "utf-8")) as T;
const data = join(here, "..", "..", "data");
const { ko, en } = messages;
const titles = (m: typeof ko) => [m.meta.tierTitle, m.meta.heroesTitle, m.meta.mapsTitle, m.meta.playersTitle, m.meta.draftTitle, m.meta.weeklyTitle, m.meta.patchesTitle];

describe("page titles per language", () => {
  it("a hero page names the hero with build, tier and counters, in each language's search words", () => {
    expect(ko.meta.heroTitle("발라")).toBe("발라 빌드·티어·상성 - 히오스");
    expect(en.meta.heroTitle("Valla")).toBe("Valla Build, Tier & Counters - Heroes of the Storm");
  });

  it("a map page names the map with its best heroes", () => {
    expect(ko.meta.mapTitle("영원의 전쟁터")).toBe("영원의 전쟁터 추천 영웅·전장 티어 - 히오스");
    expect(en.meta.mapTitle("Battlefield of Eternity")).toBe("Battlefield of Eternity: Best Heroes & Map Tier List - Heroes of the Storm");
  });

  it("every section title says the game the way that language searches it", () => {
    for (const t of titles(ko)) expect(t).toContain("히오스");
    for (const t of titles(en)) expect(t).toContain("Heroes of the Storm");
    expect(ko.meta.hotsTitle).toContain("히오스");
    expect(en.meta.hotsTitle).toContain("Heroes of the Storm");
  });

  it("the site name is a short suffix, not a second copy of the game's name", () => {
    expect(ko.meta.hotsTemplate).toBe("%s | HPGG");
    expect(en.meta.hotsTemplate).toBe("%s | HPGG");
  });
});

describe("Naver site verification", () => {
  it("every page carries the tag", () => {
    expect(NAVER_SITE_VERIFICATION).toMatch(/^[0-9a-f]{40}$/);
    for (const l of ["ko", "en"] as const) {
      expect(rootMetadata(l).verification?.other?.["naver-site-verification"]).toBe(NAVER_SITE_VERIFICATION);
    }
  });

  it("the site root (a forwarding page, the URL Naver checks) carries it too", () => {
    const root = forwarders(json<HeroTable>(join(data, "heroes_ko.json")), json<MapTable>(join(data, "maps_ko.json"))).find((f) => f.path === "index.html")!;
    expect(root.html).toContain(`<meta name="naver-site-verification" content="${NAVER_SITE_VERIFICATION}">`);
  });
});
