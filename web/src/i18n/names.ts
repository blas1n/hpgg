/** Hero, role and map names in the page language. The tables keep their field names (`ko`, `role_ko` from
 *  heroes_ko.json): they are the display fields, and on another language's pages they carry that language's game
 *  names, read from the field named after the locale (`en`: gamestrings enus via tools/build_assets.py; a map's `name`
 *  is its English battleground name and the fallback). `alt` keeps the Korean name searchable on those pages.
 *  Keys (`name`, `slug`, `role`) never change. */
import type { HeroTable, MapTable } from "../data";
import { DEFAULT_LOCALE, type Locale } from "./locale";

/** A string field named after a locale (`en`, `desc_en`, …); undefined when the data has none. */
export function localField(o: object | undefined, key: string): string | undefined {
  const v = o ? (o as Record<string, unknown>)[key] : undefined;
  return typeof v === "string" ? v : undefined;
}

export function localizeHeroes(t: HeroTable, locale: Locale): HeroTable {
  if (locale === DEFAULT_LOCALE) return t;
  const role = new Map(t.roles.map((r) => [r.name, localField(r, locale) ?? r.name]));
  return {
    ...t,
    roles: t.roles.map((r) => ({ ...r, ko: role.get(r.name) ?? r.name })),
    heroes: t.heroes.map((h) => ({ ...h, ko: localField(h, locale) ?? h.name, role_ko: role.get(h.role) ?? h.role, alt: h.ko })),
  };
}

export function localizeMaps(t: MapTable, locale: Locale): MapTable {
  if (locale === DEFAULT_LOCALE) return t;
  const name = <M extends { name: string }>(m: M) => ({ ...m, ko: localField(m, locale) ?? m.name });
  return { ...t, maps: t.maps.map(name), ...(t.aram ? { aram: t.aram.map(name) } : {}) };
}
