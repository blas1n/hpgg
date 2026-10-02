import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { robotsTxt, sitemapUrls, sitemapXml } from "../scripts/sitemap";
import { LOCALES, SITE_URL } from "../src/i18n/locales";
import { sectionEnabled } from "../src/features";
import type { HeroTable, MapTable } from "../src/data";

// robots.txt and sitemap.xml were 404 before the first community post (2026-10-02). The sitemap is made from the
// same hero and map lists the pages are generated from, and from the route directories themselves, so a new page
// cannot be left out of it.

const here = dirname(fileURLToPath(import.meta.url));
const json = <T>(p: string): T => JSON.parse(readFileSync(p, "utf-8")) as T;
const data = join(here, "..", "..", "data");
const heroes = json<HeroTable>(join(data, "heroes_ko.json"));
const maps = json<MapTable>(join(data, "maps_ko.json"));
const urls = sitemapUrls(heroes, maps);

describe("sitemap", () => {
  it("lists every static section under app/[locale]/hots in every language, unless its feature is off", () => {
    const sections = readdirSync(join(here, "..", "app", "[locale]", "hots"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("["))
      .map((d) => d.name);
    expect(sections.length).toBeGreaterThan(3);
    for (const l of LOCALES) {
      expect(urls).toContain(`${SITE_URL}/${l}/hots/`);
      for (const s of sections) {
        if (sectionEnabled(s)) expect(urls).toContain(`${SITE_URL}/${l}/hots/${s}/`);
        else expect(urls.some((u) => u.startsWith(`${SITE_URL}/${l}/hots/${s}/`))).toBe(false);
      }
    }
  });

  it("lists every hero and map page in every language", () => {
    for (const l of LOCALES) {
      for (const h of heroes.heroes) expect(urls).toContain(`${SITE_URL}/${l}/hots/heroes/${h.slug}/`);
      for (const m of maps.maps) expect(urls).toContain(`${SITE_URL}/${l}/hots/maps/${m.slug}/`);
    }
  });

  it("lists no forwarding page and no duplicate", () => {
    expect(urls.every((u) => LOCALES.some((l) => u.startsWith(`${SITE_URL}/${l}/`)))).toBe(true);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("is a urlset with one <loc> per page", () => {
    const xml = sitemapXml(heroes, maps);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.match(/<loc>/g)?.length).toBe(urls.length);
  });
});

describe("robots.txt", () => {
  it("allows crawling and names the sitemap", () => {
    const txt = robotsTxt();
    expect(txt).toMatch(/^User-agent: \*$/m);
    expect(txt).toMatch(/^Allow: \/$/m);
    expect(txt).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
  });
});
