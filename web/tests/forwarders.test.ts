import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { forwarders, writeForwarders, type Forwarder } from "../scripts/forwarders";
import { LOCALES } from "../src/i18n/locales";
import type { HeroTable, MapTable } from "../src/data";

// #10: Korean moved from /hots/… to /ko/hots/…. Every URL that was live before keeps working through a static
// forwarding page generated from the same hero and map lists the pages are generated from.

const here = dirname(fileURLToPath(import.meta.url));
const json = <T>(p: string): T => JSON.parse(readFileSync(p, "utf-8")) as T;
const data = join(here, "..", "..", "data");
const heroes = json<HeroTable>(join(data, "heroes_ko.json"));
const maps = json<MapTable>(join(data, "maps_ko.json"));
const list = forwarders(heroes, maps);
const at = (path: string): Forwarder => {
  const f = list.find((x) => x.path === path);
  if (!f) throw new Error(`no forwarder for ${path}`);
  return f;
};

/** Run a forwarder's script like a browser would: returns where it sends the visitor. */
function run(f: Forwarder, href: string, stored: string | null = null): string {
  const script = /<script>([\s\S]*?)<\/script>/.exec(f.html)![1]!;
  const u = new URL(href);
  let went = "";
  new Function("localStorage", "location", script)(
    { getItem: () => stored },
    { pathname: u.pathname, search: u.search, hash: u.hash, replace: (to: string) => (went = to) },
  );
  return went;
}

describe("forwarders for the old Korean URLs", () => {
  it("every hero and every map page that was live has one, plus the section pages, the root and the legacy .html pages", () => {
    const paths = new Set(list.map((f) => f.path));
    for (const h of heroes.heroes) expect(paths, h.slug).toContain(`hots/heroes/${h.slug}/index.html`);
    for (const m of maps.maps) expect(paths, m.slug).toContain(`hots/maps/${m.slug}/index.html`);
    for (const p of ["index.html", "hots/index.html", "hots/tier/index.html", "hots/heroes/index.html", "hots/maps/index.html", "hots/players/index.html"]) expect(paths).toContain(p);
    for (const p of ["hots/hero.html", "hots/heroes.html", "hots/maps.html", "hots/tier.html"]) expect(paths).toContain(p);
    expect(list.length).toBe(heroes.heroes.length + maps.maps.length + 6 + 4);
    expect(paths.size).toBe(list.length);
  });

  it("control: a hero missing from the list would be caught", () => {
    const fewer = forwarders({ ...heroes, heroes: heroes.heroes.slice(1) }, maps).map((f) => f.path);
    expect(fewer).not.toContain(`hots/heroes/${heroes.heroes[0]!.slug}/index.html`);
  });

  it("each page: meta refresh, canonical to the new Korean URL, noindex, and a script that keeps query and hash", () => {
    const f = at("hots/heroes/illidan/index.html");
    expect(f.target).toBe("/ko/hots/heroes/illidan/");
    expect(f.html).toContain('<meta http-equiv="refresh" content="0; url=/ko/hots/heroes/illidan/">');
    expect(f.html).toContain('<link rel="canonical" href="https://hpgg.win/ko/hots/heroes/illidan/">');
    expect(f.html).toContain('<meta name="robots" content="noindex">');
    expect(run(f, "https://hpgg.win/hots/heroes/illidan/?mode=sl#builds-title")).toBe("/ko/hots/heroes/illidan/?mode=sl#builds-title");
  });

  it("a visitor who chose a language lands in it directly (one hop); an unknown stored value is ignored", () => {
    const f = at("hots/tier/index.html");
    expect(run(f, "https://hpgg.win/hots/tier/?mode=sl", "en")).toBe("/en/hots/tier/?mode=sl");
    expect(run(f, "https://hpgg.win/hots/tier/", "fr")).toBe("/ko/hots/tier/");
    for (const l of LOCALES) expect(run(at("index.html"), "https://hpgg.win/", l)).toBe(`/${l}/hots/`);
    expect(run(at("index.html"), "https://hpgg.win/")).toBe("/ko/hots/");
  });

  it("the legacy .html pages go straight to the final URL (no chain through /hots/…)", () => {
    expect(run(at("hots/tier.html"), "https://hpgg.win/hots/tier.html?mode=sl&map=Cursed%20Hollow")).toBe("/ko/hots/tier/?mode=sl&map=Cursed%20Hollow");
    expect(run(at("hots/heroes.html"), "https://hpgg.win/hots/heroes.html")).toBe("/ko/hots/heroes/");
    expect(run(at("hots/maps.html"), "https://hpgg.win/hots/maps.html")).toBe("/ko/hots/maps/");
    // hero.html?hero=<slug>&mode=sl → the hero page, the other parameters kept
    expect(run(at("hots/hero.html"), "https://hpgg.win/hots/hero.html?hero=illidan&mode=sl")).toBe("/ko/hots/heroes/illidan/?mode=sl");
    expect(run(at("hots/hero.html"), "https://hpgg.win/hots/hero.html", "en")).toBe("/en/hots/heroes/");
  });

  it("writeForwarders puts them where GitHub Pages serves the old URLs", () => {
    const dir = mkdtempSync(join(tmpdir(), "fwd-"));
    try {
      writeForwarders(dir, heroes, maps);
      expect(existsSync(join(dir, "hots/heroes/illidan/index.html"))).toBe(true);
      expect(readFileSync(join(dir, "hots/tier.html"), "utf-8")).toBe(at("hots/tier.html").html);
      expect(readdirSync(join(dir, "hots/heroes")).length).toBe(heroes.heroes.length + 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
