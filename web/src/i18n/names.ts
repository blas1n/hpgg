/** Hero, role and map names in the page language. The tables keep their field names (`ko`, `role_ko` from
 *  heroes_ko.json): they are the display fields, and on English pages they carry the English game names
 *  (gamestrings enus via tools/build_assets.py; a map's `name` is its English battleground name). `alt` keeps the
 *  Korean name searchable on English pages. Keys (`name`, `slug`, `role`) never change. */
import type { HeroTable, MapTable } from "../data";
import type { Locale } from "./locale";

export function localizeHeroes(t: HeroTable, locale: Locale): HeroTable {
  if (locale === "ko") return t;
  const role = new Map(t.roles.map((r) => [r.name, r.en ?? r.name]));
  return {
    ...t,
    roles: t.roles.map((r) => ({ ...r, ko: role.get(r.name) ?? r.name })),
    heroes: t.heroes.map((h) => ({ ...h, ko: h.en ?? h.name, role_ko: role.get(h.role) ?? h.role, alt: h.ko })),
  };
}

export function localizeMaps(t: MapTable, locale: Locale): MapTable {
  if (locale === "ko") return t;
  return { ...t, maps: t.maps.map((m) => ({ ...m, ko: m.name })), ...(t.aram ? { aram: t.aram.map((m) => ({ ...m, ko: m.name })) } : {}) };
}
