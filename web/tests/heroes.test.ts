import { describe, expect, it } from "vitest";
import type { SearchItem } from "../src/lib/search";
import { filterHeroes } from "../src/lib/heroes";

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
