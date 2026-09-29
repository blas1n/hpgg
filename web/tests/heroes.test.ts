import { describe, expect, it } from "vitest";
import type { SearchItem } from "../src/lib/search";
import { filterHeroes } from "../src/lib/heroes";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { messages } from "../src/i18n/messages";
import { LOCALES } from "../src/i18n/locales";

const item = (slug: string, ko: string, name: string, role: string): SearchItem => ({ slug, ko, name, role, role_ko: role });
const ITEMS: SearchItem[] = [
  item("diablo", "디아블로", "Diablo", "Tank"),
  item("illidan", "일리단", "Illidan", "Melee Assassin"),
  item("li-li", "리리", "Li Li", "Healer"),
  item("li-ming", "리밍", "Li-Ming", "Ranged Assassin"),
];

describe("filterHeroes", () => {
  it("no query, every role: the whole list in its given (Korean name) order", () => {
    expect(filterHeroes(ITEMS, "all", "").map((h) => h.slug)).toEqual(["diablo", "illidan", "li-li", "li-ming"]);
  });

  it("role only", () => {
    expect(filterHeroes(ITEMS, "Healer", "").map((h) => h.slug)).toEqual(["li-li"]);
  });

  it("query uses the header search: Korean, English and 초성, best match first, no result cap", () => {
    expect(filterHeroes(ITEMS, "all", "일리").map((h) => h.slug)).toEqual(["illidan"]);
    expect(filterHeroes(ITEMS, "all", "ㄹㄹ").map((h) => h.slug)).toEqual(["li-li"]);
    expect(filterHeroes(ITEMS, "all", "li").map((h) => h.slug)).toEqual(["li-li", "li-ming", "illidan"]);
    const many = Array.from({ length: 20 }, (_, i) => item(`h${i}`, `영웅${i}`, `Hero${i}`, "Tank"));
    expect(filterHeroes(many, "all", "hero")).toHaveLength(20); // the header box stops at 8, the grid does not
  });

  it("query and role together", () => {
    expect(filterHeroes(ITEMS, "Ranged Assassin", "li").map((h) => h.slug)).toEqual(["li-ming"]);
  });
});

describe("universe filter (#43)", () => {
  const withU = (i: SearchItem, franchise?: string) => ({ ...i, ...(franchise ? { franchise } : {}) });
  const U = [withU(ITEMS[0]!, "Diablo"), withU(ITEMS[1]!, "Warcraft"), withU(ITEMS[2]!, "Warcraft"), withU(ITEMS[3]!, "Diablo")];

  it("keeps only the heroes of that universe; 'all' keeps everyone", () => {
    expect(filterHeroes(U, "all", "", "Warcraft").map((h) => h.slug)).toEqual(["illidan", "li-li"]);
    expect(filterHeroes(U, "all", "", "all")).toHaveLength(4);
    expect(filterHeroes(U, "all", "")).toHaveLength(4);
  });

  it("combines with the role and the query", () => {
    expect(filterHeroes(U, "Ranged Assassin", "", "Diablo").map((h) => h.slug)).toEqual(["li-ming"]);
    expect(filterHeroes(U, "all", "li", "Warcraft").map((h) => h.slug)).toEqual(["li-li", "illidan"]); // not Li-Ming (Diablo)
  });

  it("every universe in the hero tables has a name in every language", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const f of [join(here, "..", "..", "data", "heroes_ko.json"), join(here, "e2e-data", "heroes_ko.json")]) {
      const heroes = JSON.parse(readFileSync(f, "utf-8")).heroes as { name: string; franchise?: string }[];
      expect(heroes.every((h) => h.franchise), f).toBe(true);
      for (const locale of LOCALES) {
        const names = messages[locale].common.universes as Record<string, string>;
        for (const h of heroes) expect(names[h.franchise!], `${locale} ${h.franchise}`).toBeTruthy();
      }
    }
  });
});
