import { describe, expect, it } from "vitest";
import { chosung, searchHeroes, unifiedSearch, type SearchItem } from "../src/lib/search";

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

describe("searchHeroes on English pages", () => {
  // the display name is English there; the Korean name rides along as `alt` so Korean players still find heroes
  const EN = ITEMS.map((h) => ({ ...h, ko: h.name, role_ko: "Tank", alt: h.ko }));
  it("matches the English name, the Korean name and its 초성", () => {
    expect(searchHeroes(EN, "illi").map((x) => x.slug)).toEqual(["illidan"]);
    expect(searchHeroes(EN, "일리").map((x) => x.slug)).toEqual(["illidan"]);
    expect(searchHeroes(EN, "ㅇㄹㄷ").map((x) => x.slug)).toEqual(["illidan"]);
  });
});

describe("unifiedSearch: one header box for a hero name or a BattleTag", () => {
  const ko = { locale: "ko" as const, region: "KR" as const };
  it("a BattleTag (full-width ＃ and spaces normalised like the player search) is a 전적 option on the visitor's region", () => {
    for (const q of ["Zemill＃1940", " Zemill ＃ 1940 ", "Zemill#1940"]) {
      const r = unifiedSearch(ITEMS, q, ko);
      expect(r.player, q).toEqual({ tag: "Zemill#1940", region: "KR", href: "/ko/hots/players/?tag=Zemill%231940&region=KR" });
      expect(r.heroes, q).toEqual([]);
      expect(r.hint, q).toBe(false);
    }
    expect(unifiedSearch(ITEMS, "Zemill#1940", { locale: "en", region: "NA" }).player?.href).toBe("/en/hots/players/?tag=Zemill%231940&region=NA");
  });

  it("a hero name gives hero results as before and no 전적 option", () => {
    const r = unifiedSearch(ITEMS, "일리", ko);
    expect(r.heroes.map((x) => x.slug)).toEqual(["illidan"]);
    expect(r.player).toBeNull();
    expect(r.hint).toBe(false);
    expect(unifiedSearch(ITEMS, "ㅇㄹㄷ", ko).heroes.map((x) => x.slug)).toEqual(["illidan"]);
  });

  it("hints at the BattleTag format for an unfinished tag, letters with digits, or a name no hero matches", () => {
    expect(unifiedSearch(ITEMS, "Zemill#19", ko)).toMatchObject({ player: null, hint: true });
    expect(unifiedSearch(ITEMS, "Zemill＃", ko)).toMatchObject({ player: null, hint: true });
    expect(unifiedSearch(ITEMS, "zemill1940", ko)).toMatchObject({ player: null, hint: true });
    expect(unifiedSearch(ITEMS, "zzzz", ko)).toMatchObject({ heroes: [], player: null, hint: true });
    expect(unifiedSearch(ITEMS, "li", ko).hint).toBe(false);
    expect(unifiedSearch(ITEMS, "  ", ko)).toEqual({ heroes: [], player: null, hint: false });
  });
});
