/**
 * Forwarding pages for the URLs that were live before every language moved under /<locale>/ (#10): /, /hots/…, one
 * per hero and map page (from the same heroes_ko.json / maps_ko.json the pages are generated from), and the older
 * hots/*.html addresses (straight to the final URL, no chain). GitHub Pages has no redirects, so each is a small HTML
 * page: a script that keeps the query and hash and honours a stored language choice, a meta refresh for browsers
 * without JS, a canonical to the new Korean URL and noindex. Written into public/ by scripts/sync-data.mjs.
 * Runs under Node (type stripping) and in vitest: value imports carry their .ts extension.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_LOCALE, LOCALE_KEY, LOCALES, SITE_URL } from "../src/i18n/locales.ts";
import type { HeroTable, MapTable } from "../src/data";

export interface Forwarder {
  /** File under the site root, e.g. hots/heroes/illidan/index.html. */
  path: string;
  /** The new page without JS, in the default language: /ko/hots/heroes/illidan/. */
  target: string;
  html: string;
}

/** `section` (/hots/…) in the stored language or the default one; `rest` is a JS expression for query + hash. */
const script = (section: string, rest = "location.search+location.hash", before = "") =>
  `(function(){var l=${JSON.stringify(DEFAULT_LOCALE)};try{var s=localStorage.getItem(${JSON.stringify(LOCALE_KEY)});if(${JSON.stringify(LOCALES)}.indexOf(s)>=0)l=s}catch(e){}${before}location.replace("/"+l+${section}+${rest})})()`;

function page(path: string, section: string, js: string): Forwarder {
  const target = `/${DEFAULT_LOCALE}${section}`;
  const html = `<!doctype html><html lang="${DEFAULT_LOCALE}"><meta charset="utf-8"><title>hpgg.win</title><meta name="robots" content="noindex"><link rel="canonical" href="${SITE_URL}${target}"><meta http-equiv="refresh" content="0; url=${target}"><script>${js}</script><a href="${target}">hpgg.win →</a></html>\n`;
  return { path, target, html };
}

const simple = (path: string, section: string) => page(path, section, script(JSON.stringify(section)));

export function forwarders(heroes: HeroTable, maps: MapTable): Forwarder[] {
  const dir = (section: string) => simple(`${section.slice(1)}index.html`, section);
  return [
    // the site root: the stored language, else Korean (one game so far)
    simple("index.html", "/hots/"),
    ...["/hots/", "/hots/tier/", "/hots/heroes/", "/hots/maps/", "/hots/players/"].map(dir),
    ...heroes.heroes.map((h) => dir(`/hots/heroes/${h.slug}/`)),
    ...maps.maps.map((m) => dir(`/hots/maps/${m.slug}/`)),
    // the pre-Next pages (2026-09-28): hots/<page>.html
    simple("hots/tier.html", "/hots/tier/"),
    simple("hots/heroes.html", "/hots/heroes/"),
    simple("hots/maps.html", "/hots/maps/"),
    // hero.html?hero=<slug>&… → /<l>/hots/heroes/<slug>/?…
    page(
      "hots/hero.html",
      "/hots/heroes/",
      script(
        `"/hots/heroes/"+(h?encodeURIComponent(h)+"/":"")`,
        `(r?"?"+r:"")+location.hash`,
        `var q=new URLSearchParams(location.search),h=q.get("hero")||"";q.delete("hero");var r=q.toString();`,
      ),
    ),
  ];
}

export function writeForwarders(root: string, heroes: HeroTable, maps: MapTable): number {
  const list = forwarders(heroes, maps);
  for (const f of list) {
    const p = join(root, f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.html);
  }
  return list.length;
}
