/** Build-time data access (server components only): reads the same files the client fetches, from DATA_DIR. */
import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { computeTiers, type Snapshot } from "../formula";
import { onReference, type Bracket, type BuildsFile, type HeroTable, type MapTable, type MatchupsFile, type Meta, type Mode, type Region, type TalentTable } from "../data";
import { pickShown, type Shown } from "../lib/shown";
import type { SearchItem } from "../lib/search";
import type { MapsMeta } from "../lib/maps";
import type { Locale } from "../i18n/locale";
import { localizeHeroes, localizeMaps } from "../i18n/names";

const dir = resolve(process.cwd(), process.env.DATA_DIR ?? "../data");
const read = <T>(rel: string): T => JSON.parse(readFileSync(join(dir, rel), "utf-8")) as T;

export const readMeta = (): Meta => read<Meta>("latest/meta.json");
const heroTable = (): HeroTable => read<HeroTable>("heroes_ko.json");
/** Heroes and maps with their display names in the page language (i18n/names.ts). */
export const readHeroes = (locale: Locale): HeroTable => localizeHeroes(heroTable(), locale);
export const readMaps = (locale: Locale): MapTable => localizeMaps(read<MapTable>("maps_ko.json"), locale);
export const readSnapshot = (key: string, patch: "current" | "previous" = "current"): Snapshot | null => {
  const rel = `${patch === "previous" ? "previous" : "latest"}/${key}.json`;
  return existsSync(join(dir, rel)) ? read<Snapshot>(rel) : null;
};

/** What a page shows for a mode (+ bracket): the same patch rule as the tier table. */
export const readShown = (mode: Mode, bracket: Bracket = "all", region: Region = "all"): Shown | null => pickShown(readMeta(), mode, bracket, readSnapshot, heroTable(), region);

const opt = <T>(rel: string): T | null => (existsSync(join(dir, rel)) ? read<T>(rel) : null);
let builds: BuildsFile | null | undefined; // 270 KB, read once per build rather than once per hero page
/** Talent builds on the reference patch only (a thin new patch's builds are not shown under an old-patch page). */
export const readBuilds = (): BuildsFile | null => (builds === undefined ? (builds = onReference(opt<BuildsFile>("latest/builds.json"), readMeta())) : builds);
/** Official objective text per map (data/maps_meta.json); null if the file is missing. */
export const readMapsMeta = (): MapsMeta | null => opt<MapsMeta>("maps_meta.json");
export const readTalents = (slug: string): TalentTable | null => opt<TalentTable>(`talents/${slug}.json`);
/** Storm League counters/synergies for one hero (collector/matchups.py); null until the first collection. */
export const readMatchups = (slug: string): MatchupsFile | null => onReference(opt<MatchupsFile>(`matchups/${slug}.json`), readMeta());

/** Header search index: every hero, sorted by name in the page language, with the current tier in `mode`. */
export function readSearchIndex(locale: Locale, mode: Mode = "qm"): SearchItem[] {
  const heroes = readHeroes(locale);
  const meta = readMeta();
  const snap = readShown(mode)?.snap;
  const tiers = snap ? computeTiers(snap.rows.filter((r) => r.map === "all"), meta.min_games_for_tier) : null;
  const tierOf = new Map(tiers?.ranked.map((x) => [x.row.hero, x.tier]) ?? []);
  return [...heroes.heroes]
    .sort((a, b) => a.ko.localeCompare(b.ko, locale))
    .map((h) => ({ slug: h.slug, ko: h.ko, name: h.name, role: h.role, role_ko: h.role_ko, portrait: h.portrait, tier: tierOf.get(h.name), ...(h.alt ? { alt: h.alt } : {}) }));
}
