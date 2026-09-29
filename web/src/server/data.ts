/** Build-time data access (server components only): reads the same files the client fetches, from DATA_DIR. */
import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { computeTiers, PRESETS, type Snapshot } from "../formula";
import type { Bracket, BuildsFile, HeroTable, MapTable, MatchupsFile, Meta, Mode, Region, TalentTable } from "../data";
import { pickShown, type Shown } from "../lib/shown";
import type { SearchItem } from "../lib/search";
import type { MapsMeta } from "../lib/maps";

const dir = resolve(process.cwd(), process.env.DATA_DIR ?? "../data");
const read = <T>(rel: string): T => JSON.parse(readFileSync(join(dir, rel), "utf-8")) as T;

export const readMeta = (): Meta => read<Meta>("latest/meta.json");
export const readHeroes = (): HeroTable => read<HeroTable>("heroes_ko.json");
export const readMaps = (): MapTable => read<MapTable>("maps_ko.json");
export const readSnapshot = (key: string, patch: "current" | "previous" = "current"): Snapshot | null => {
  const rel = `${patch === "previous" ? "previous" : "latest"}/${key}.json`;
  return existsSync(join(dir, rel)) ? read<Snapshot>(rel) : null;
};

/** What a page shows for a mode (+ bracket): the same patch rule as the tier table. */
export const readShown = (mode: Mode, bracket: Bracket = "all", region: Region = "all"): Shown | null => pickShown(readMeta(), mode, bracket, readSnapshot, readHeroes(), region);

const opt = <T>(rel: string): T | null => (existsSync(join(dir, rel)) ? read<T>(rel) : null);
let builds: BuildsFile | null | undefined; // 270 KB, read once per build rather than once per hero page
export const readBuilds = (): BuildsFile | null => (builds === undefined ? (builds = opt<BuildsFile>("latest/builds.json")) : builds);
/** Official objective text per map (data/maps_meta.json); null if the file is missing. */
export const readMapsMeta = (): MapsMeta | null => opt<MapsMeta>("maps_meta.json");
export const readTalents = (slug: string): TalentTable | null => opt<TalentTable>(`talents/${slug}.json`);
/** Storm League counters/synergies for one hero (collector/matchups.py); null until the first collection. */
export const readMatchups = (slug: string): MatchupsFile | null => opt<MatchupsFile>(`matchups/${slug}.json`);

/** Header search index: every hero, sorted by Korean name, with the current Quick Match tier. */
export function readSearchIndex(mode: Mode = "qm"): SearchItem[] {
  const heroes = readHeroes();
  const meta = readMeta();
  const snap = readShown(mode)?.snap;
  const tiers = snap ? computeTiers(snap.rows.filter((r) => r.map === "all"), PRESETS.aichi, meta.min_games_for_tier) : null;
  const tierOf = new Map(tiers?.ranked.map((x) => [x.row.hero, x.tier]) ?? []);
  return [...heroes.heroes]
    .sort((a, b) => a.ko.localeCompare(b.ko, "ko"))
    .map((h) => ({ slug: h.slug, ko: h.ko, name: h.name, role: h.role, role_ko: h.role_ko, portrait: h.portrait, tier: tierOf.get(h.name) }));
}
