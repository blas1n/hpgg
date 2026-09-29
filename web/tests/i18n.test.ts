import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { messages, type Messages } from "../src/i18n/messages";
import { DEFAULT_LOCALE, LOCALES, localeOfPath, localeParams, localizedPath, readLocale, sectionPath, writeLocale, chooseLocale, LOCALE_KEY, alternates, LOCALE_REDIRECT_SCRIPT } from "../src/i18n/locale";
import { localizeHeroes, localizeMaps } from "../src/i18n/names";
import type { HeroTable, MapTable } from "../src/data";

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/;
const here = dirname(fileURLToPath(import.meta.url));
const json = <T>(rel: string): T => JSON.parse(readFileSync(join(here, rel), "utf-8")) as T;

type Leaf = { path: string; kind: "string" | "function"; arity: number; value: unknown };
function leaves(o: unknown, path = ""): Leaf[] {
  if (typeof o === "string") return [{ path, kind: "string", arity: 0, value: o }];
  if (typeof o === "function") return [{ path, kind: "function", arity: o.length, value: o }];
  if (o && typeof o === "object") return Object.entries(o).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  throw new Error(`${path}: unexpected ${typeof o}`);
}
/** Every message rendered once: strings as they are, functions called with a sample argument per parameter. */
const rendered = (m: Messages): { path: string; text: string }[] =>
  leaves(m).map((l) => ({ path: l.path, text: l.kind === "string" ? (l.value as string) : String((l.value as (...a: unknown[]) => unknown)(...Array(l.arity).fill(7))) }));

describe("message tables", () => {
  const ko = leaves(messages.ko);
  const en = leaves(messages.en);

  it("both locales have exactly the same keys, and each key is the same kind (text, or a function of the same arity)", () => {
    expect(ko.length).toBeGreaterThan(150); // control: the walk sees the whole table
    expect(en.map((l) => `${l.path}:${l.kind}/${l.arity}`)).toEqual(ko.map((l) => `${l.path}:${l.kind}/${l.arity}`));
  });

  it("no message is empty in either locale", () => {
    for (const locale of LOCALES) for (const r of rendered(messages[locale])) expect(r.text.trim(), `${locale} ${r.path}`).not.toBe("");
  });

  it("the English table is translated: no Hangul anywhere in it (no Korean placeholder shipped)", () => {
    const left = rendered(messages.en).filter((r) => HANGUL.test(r.text));
    expect(left.map((r) => `${r.path}: ${r.text}`)).toEqual([]);
  });

  it("control: the Hangul check sees Korean text (the Korean table would fail it)", () => {
    expect(rendered(messages.ko).filter((r) => HANGUL.test(r.text)).length).toBeGreaterThan(100);
  });

  it("copy rules hold in both languages: no voting, no claim that the tiers match anyone's gut feel", () => {
    for (const locale of LOCALES) {
      const all = rendered(messages[locale]).map((r) => r.text).join("\n");
      expect(all, locale).not.toMatch(/체감|gut|feel|투표|vote|👍|👎/i);
    }
  });
});

describe("locale paths", () => {
  it("every language, Korean included, lives under /<locale>/", () => {
    expect(localizedPath("/hots/tier/", "ko")).toBe("/ko/hots/tier/");
    expect(localizedPath("/hots/tier/", "en")).toBe("/en/hots/tier/");
    expect(localizedPath("/en/hots/heroes/illidan/", "ko")).toBe("/ko/hots/heroes/illidan/");
    expect(localizedPath("/ko/hots/heroes/illidan/", "en")).toBe("/en/hots/heroes/illidan/");
    expect(localizedPath("/en/hots/heroes/illidan/", "en")).toBe("/en/hots/heroes/illidan/");
    expect(localizedPath("/", "en")).toBe("/en/");
    expect(localizedPath("/en/", "ko")).toBe("/ko/");
    expect(localizedPath("/en", "ko")).toBe("/ko/");
  });

  it("the locale of a path; the section path without it", () => {
    expect(localeOfPath("/ko/hots/")).toBe("ko");
    expect(localeOfPath("/en/hots/")).toBe("en");
    expect(localeOfPath("/en")).toBe("en");
    expect(localeOfPath("/enx/")).toBeNull();
    expect(localeOfPath("/hots/")).toBeNull(); // an old URL: forwarded (scripts/forwarders.ts)
    expect(sectionPath("/en/hots/maps/")).toBe("/hots/maps/");
    expect(sectionPath("/hots/maps/")).toBe("/hots/maps/");
  });

  it("hreflang alternates: one per locale, x-default = Korean, as absolute URLs", () => {
    expect(alternates("/hots/maps/", "en")).toEqual({
      canonical: "https://hpgg.win/en/hots/maps/",
      languages: { ko: "https://hpgg.win/ko/hots/maps/", en: "https://hpgg.win/en/hots/maps/", "x-default": "https://hpgg.win/ko/hots/maps/" },
    });
    expect(alternates("/hots/maps/", "ko").canonical).toBe("https://hpgg.win/ko/hots/maps/");
  });

  it("one list of languages drives everything: each has a message table, and the route params come from it", () => {
    expect(LOCALES).toEqual(["ko", "en"]);
    expect(Object.keys(messages).sort()).toEqual([...LOCALES].sort());
    expect(localeParams()).toEqual(LOCALES.map((locale) => ({ locale })));
    expect(DEFAULT_LOCALE).toBe(LOCALES[0]);
  });
});

describe("stored language choice (a redirect hint only)", () => {
  it("reads the stored choice; anything else, a throwing storage or none at all is 'no choice'", () => {
    expect(readLocale(() => ({ getItem: (k: string) => (k === LOCALE_KEY ? "en" : null) }))).toBe("en");
    expect(readLocale(() => ({ getItem: () => "ko" }))).toBe("ko");
    expect(readLocale(() => ({ getItem: () => "fr" }))).toBeNull();
    expect(readLocale(() => null)).toBeNull();
    expect(
      readLocale(() => {
        throw new Error("SecurityError");
      }),
    ).toBeNull();
  });

  it("writing survives a refusing browser", () => {
    const store: Record<string, string> = {};
    expect(writeLocale("en", () => ({ setItem: (k: string, v: string) => void (store[k] = v) }))).toBe(true);
    expect(store[LOCALE_KEY]).toBe("en");
    expect(
      writeLocale("en", () => {
        throw new Error("SecurityError");
      }),
    ).toBe(false);
  });

  it("choosing a language never leaves an old choice behind: when the write fails the stored hint is removed", () => {
    // otherwise a stored "en" + a refused write of "ko" would send the Korean page straight back to English
    const store: Record<string, string> = { [LOCALE_KEY]: "en" };
    const quotaFull = { setItem: () => { throw new Error("QuotaExceededError"); }, removeItem: (k: string) => void delete store[k] };
    expect(chooseLocale("ko", () => quotaFull)).toBe(false);
    expect(store[LOCALE_KEY]).toBeUndefined();
    const ok = { setItem: (k: string, v: string) => void (store[k] = v), removeItem: () => {} };
    expect(chooseLocale("en", () => ok)).toBe(true);
    expect(store[LOCALE_KEY]).toBe("en");
    expect(chooseLocale("ko", () => { throw new Error("SecurityError"); })).toBe(false); // blocked storage: nothing to clear, no throw
  });

  it("the head script redirects only when a different language was chosen, keeping the query and hash", () => {
    const run = (locale: "ko" | "en", stored: string | null, href: string) => {
      const u = new URL(href);
      let went: string | null = null;
      const fn = new Function("document", "localStorage", "location", LOCALE_REDIRECT_SCRIPT(locale));
      fn(
        {},
        { getItem: () => stored },
        { pathname: u.pathname, search: u.search, hash: u.hash, replace: (to: string) => (went = to) },
      );
      return went;
    };
    expect(run("ko", "en", "https://hpgg.win/ko/hots/tier/?mode=sl#x")).toBe("/en/hots/tier/?mode=sl#x");
    expect(run("en", "ko", "https://hpgg.win/en/hots/heroes/illidan/")).toBe("/ko/hots/heroes/illidan/");
    expect(run("ko", "ko", "https://hpgg.win/ko/hots/")).toBeNull();
    expect(run("ko", null, "https://hpgg.win/ko/hots/")).toBeNull();
    expect(run("en", null, "https://hpgg.win/en/hots/")).toBeNull();
    expect(run("ko", "fr", "https://hpgg.win/ko/hots/")).toBeNull(); // not a language of the site
  });
});

describe("names in the page language", () => {
  const heroes = json<HeroTable>("e2e-data/heroes_ko.json");
  const maps = json<MapTable>("e2e-data/maps_ko.json");

  it("Korean pages see the table as it is", () => {
    expect(localizeHeroes(heroes, "ko")).toBe(heroes);
    expect(localizeMaps(maps, "ko")).toBe(maps);
  });

  it("English pages get the English game names in the display fields; keys (name, slug, role) stay", () => {
    const en = localizeHeroes(heroes, "en");
    const illidan = en.heroes.find((h) => h.slug === "illidan")!;
    expect(illidan).toMatchObject({ name: "Illidan", ko: "Illidan", role: "Melee Assassin", role_ko: "Melee Assassin" });
    expect(en.heroes.every((h) => !HANGUL.test(h.ko) && !HANGUL.test(h.role_ko))).toBe(true);
    expect(en.roles.map((r) => r.ko)).toEqual(heroes.roles.map((r) => r.name));
    const m = localizeMaps(maps, "en");
    expect(m.maps.find((x) => x.slug === "cursed-hollow")!.ko).toBe("Cursed Hollow");
    expect(m.aram?.find((x) => x.name === "Silver City")!.ko).toBe("Silver City");
  });
});
