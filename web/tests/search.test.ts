import { describe, expect, it } from "vitest";
import { chosung, searchHeroes, type SearchItem } from "../src/lib/search";

const item = (slug: string, ko: string, name: string): SearchItem => ({ slug, ko, name, role: "Tank", role_ko: "전사" });
const ITEMS: SearchItem[] = [
  item("illidan", "일리단", "Illidan"),
  item("li-li", "리리", "Li Li"),
  item("li-ming", "리밍", "Li-Ming"),
  item("lili-and-lunara", "루나라", "Lunara"),
  item("the-lost-vikings", "길 잃은 바이킹", "The Lost Vikings"),
  item("lucio", "루시우", "Lúcio"),
];

describe("chosung", () => {
  it("maps Hangul syllables to their initial consonants and keeps other characters", () => {
    expect(chosung("일리단")).toBe("ㅇㄹㄷ");
    expect(chosung("길 잃은 바이킹")).toBe("ㄱ ㅇㅇ ㅂㅇㅋ");
    expect(chosung("D.Va")).toBe("D.Va");
  });
});

describe("searchHeroes", () => {
  it("returns nothing for an empty or blank query", () => {
    expect(searchHeroes(ITEMS, "")).toEqual([]);
    expect(searchHeroes(ITEMS, "   ")).toEqual([]);
  });

  it("matches Korean names by substring", () => {
    expect(searchHeroes(ITEMS, "바이킹").map((x) => x.slug)).toEqual(["the-lost-vikings"]);
  });

  it("matches English names case-insensitively, ignoring accents and punctuation", () => {
    expect(searchHeroes(ITEMS, "illi").map((x) => x.slug)).toEqual(["illidan"]);
    expect(searchHeroes(ITEMS, "lucio").map((x) => x.slug)).toEqual(["lucio"]);
    expect(searchHeroes(ITEMS, "liming").map((x) => x.slug)).toEqual(["li-ming"]);
  });

  it("matches initial consonants (초성)", () => {
    expect(searchHeroes(ITEMS, "ㅇㄹㄷ").map((x) => x.slug)).toEqual(["illidan"]);
    expect(searchHeroes(ITEMS, "ㄹㅁ").map((x) => x.slug)).toEqual(["li-ming"]);
  });

  it("ranks exact and prefix matches above substring matches", () => {
    // "리" is a prefix of 리리/리밍 and only a substring of 일리단
    expect(searchHeroes(ITEMS, "리").map((x) => x.slug)).toEqual(["li-li", "li-ming", "illidan"]);
    expect(searchHeroes(ITEMS, "리리")[0]!.slug).toBe("li-li");
  });

  it("respects the limit", () => {
    expect(searchHeroes(ITEMS, "l", 2)).toHaveLength(2);
  });
});
