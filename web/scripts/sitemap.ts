/**
 * robots.txt and sitemap.xml for the static export (both were 404 until 2026-10-02). Every page in every language,
 * made from the same heroes_ko.json / maps_ko.json the pages are generated from; forwarding pages (noindex) are left
 * out. Written into public/ by scripts/sync-data.mjs. Runs under Node (type stripping) and in vitest: value imports
 * carry their .ts extension.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { LOCALES, SITE_URL } from "../src/i18n/locales.ts";
import type { HeroTable, MapTable } from "../src/data";

/** The static sections under app/[locale]/hots (tests/sitemap.test.ts fails when a directory is missing here). */
const SECTIONS = ["tier", "heroes", "maps", "draft", "players"];

export function sitemapUrls(heroes: HeroTable, maps: MapTable): string[] {
  return LOCALES.flatMap((l) => {
    const base = `${SITE_URL}/${l}/hots/`;
    return [
      base,
      ...SECTIONS.map((s) => `${base}${s}/`),
      ...heroes.heroes.map((h) => `${base}heroes/${h.slug}/`),
      ...maps.maps.map((m) => `${base}maps/${m.slug}/`),
    ];
  });
}

export function sitemapXml(heroes: HeroTable, maps: MapTable): string {
  const urls = sitemapUrls(heroes, maps).map((u) => `  <url><loc>${u}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

export const robotsTxt = (): string => `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;

export function writeSitemap(pub: string, heroes: HeroTable, maps: MapTable): number {
  writeFileSync(join(pub, "robots.txt"), robotsTxt());
  writeFileSync(join(pub, "sitemap.xml"), sitemapXml(heroes, maps));
  return sitemapUrls(heroes, maps).length;
}
