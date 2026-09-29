import type { Snapshot } from "./formula";
import { localizedPath, type Locale } from "./i18n/locale";
import { knownOnly } from "./lib/known";

export interface Meta {
  current_patch: string;
  previous_patch: string | null;
  patch_started_at: string;
  collected_at: string;
  min_games_for_tier: number;
  /** Per snapshot file key (qm, sl, sl_low, qm_kr, …); `collected_at` is set since #14 (regions rotate, so their dates differ). */
  modes: Record<string, { matches: number; heroes: number; heroes_over_200: number; collected_at?: string }>;
}

/** `ko` / `role_ko` are the display names: Korean in heroes_ko.json, English on English pages (i18n/names.ts). */
export interface HeroInfo {
  name: string;
  slug: string;
  ko: string;
  /** English game name (gamestrings enus). */
  en?: string;
  /** The name in the other language, searchable too (set on English pages). */
  alt?: string;
  role: string;
  role_ko: string;
  portrait?: string; // e.g. img/heroes/qhira.png (relative to the site root)
  short_name?: string; // Heroes Profile short_name (player search matches heroes by it)
  /** Universe (#43): Warcraft, Starcraft, Diablo, Overwatch, Nexus — grouped as on Blizzard's heroes page. */
  franchise?: string;
}
export interface HeroTable {
  roles: { name: string; ko: string; en?: string }[];
  heroes: HeroInfo[];
}
export interface MapTable {
  maps: { name: string; ko: string; slug: string; image?: string }[];
  /** ARAM maps: names only, for player search (no stats are collected for them). */
  aram?: { name: string; ko: string }[];
}

/** data/ is published at the site root (https://hpgg.win/latest/…, /img/…). */
const base = "/";
export const assetUrl = (rel: string): string => base + rel;

/** Site routes for the Heroes of the Storm section, in a language: Korean /hots/…, English /en/hots/…. */
export function hotsHref(locale: Locale) {
  const p = (path: string) => localizedPath(path, locale);
  return {
    home: p("/hots/"),
    tier: (qs?: URLSearchParams | string) => p("/hots/tier/") + (qs && String(qs) ? `?${String(qs)}` : ""),
    heroes: p("/hots/heroes/"),
    hero: (slug: string, mode?: Mode) => p(`/hots/heroes/${encodeURIComponent(slug)}/`) + (mode === "sl" ? "?mode=sl" : ""),
    maps: p("/hots/maps/"),
    players: p("/hots/players/"),
    map: (slug: string) => p(`/hots/maps/${encodeURIComponent(slug)}/`),
  };
}

export type Mode = "qm" | "sl";
export type Bracket = "all" | "low" | "high";
/** Labels: messages common.modes / common.brackets / common.regions. Two brackets while the player base is small
 *  (owner, 2026-09-29): league_tier 1-4 / 5-6; grandmasters are inside master.
 *  What each bracket means in league tiers (1 bronze … 6 master). A file whose league_tier differs is another cohort. */
export const BRACKET_TIERS: Record<Bracket, number[] | null> = { all: null, low: [1, 2, 3, 4], high: [5, 6] };
/** Snapshot file key for a mode + bracket (brackets exist for Storm League only). */
/** Regions (#14): one region is collected a day for QM + SL (KR → NA → EU), so each region is up to three days old.
 *  The in-game Asia server is HP's `KR`; CN is a separate server and not collected. */
export type Region = "all" | "kr" | "na" | "eu";
export const REGIONS: Region[] = ["all", "kr", "na", "eu"];
/** The `region` a file carries (HP's code); null = every region. */
export const REGION_CODE: Record<Region, string | null> = { all: null, kr: "KR", na: "NA", eu: "EU" };
/** Snapshot file key for a mode + bracket (brackets exist for Storm League only) or a region. Region × bracket is not collected. */
export function snapshotKey(mode: Mode, bracket: Bracket, region: Region = "all"): string {
  if (region !== "all") {
    if (bracket !== "all") throw new Error("region × bracket is not collected");
    return `${mode}_${region}`;
  }
  return mode === "sl" && bracket !== "all" ? `sl_${bracket}` : mode;
}
export type PatchChoice = "current" | "previous";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(base + path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** A snapshot file as the pages see it: rows of heroes without assets dropped (lib/known.ts). */
export const loadSnapshot = async (key: string, patch: PatchChoice, heroes: HeroTable): Promise<Snapshot> =>
  knownOnly(await getJson<Snapshot>(`${patch === "previous" ? "previous" : "latest"}/${key}.json`), heroes);

/** Right after a patch the current build is thin; fall back to the previous patch for that mode. */
/** `key`: a mode, or any snapshot file key (a region's file has its own sample size). */
export function thinSample(meta: Meta, key: string): boolean {
  const m = meta.modes[key];
  if (!m || !m.heroes) return false;
  return m.heroes_over_200 / m.heroes < 0.5;
}

/** A region's sample health and collection date from meta; null = that region has not been collected yet. */
export function regionSample(meta: Meta, mode: Mode, region: Exclude<Region, "all">): { collectedAt: string | null; heroes: number; over: number; thin: boolean } | null {
  const key = snapshotKey(mode, "all", region);
  const m = meta.modes[key];
  if (!m) return null;
  return { collectedAt: m.collected_at ?? null, heroes: m.heroes, over: m.heroes_over_200, thin: thinSample(meta, key) };
}

export function daysSince(isoDate: string, now = new Date()): number {
  const start = new Date(isoDate + "T00:00:00Z").getTime();
  return Math.max(0, Math.floor((now.getTime() - start) / 86_400_000));
}

/** "2026-09-28T04:07:19Z" → "09/28" */
export const shortDate = (iso: string): string => iso.slice(5, 10).replace("-", "/");

export interface BuildTalent {
  level: number;
  name: string; // HP talent_name == game nameId
  title: string; // English
}
export interface Build {
  games: number;
  win_rate: number;
  talents: BuildTalent[];
}
export interface BuildsFile {
  patch: string;
  game_type: string;
  collected_at: string;
  heroes: Record<string, Build[]>;
}
export interface TalentInfo {
  ko: string;
  icon: string;
  /** Game tooltip as text; {{…}} marks a highlighted value, \n a line break. */
  desc?: string;
  cd?: string;
  /** English name, tooltip and cooldown (gamestrings enus). */
  en?: string;
  desc_en?: string;
  cd_en?: string;
}
/** One other hero in data/matchups/<slug>.json: the page hero's record with (ally) or against (enemy) it. */
export interface MatchupPair {
  hero: string; // API name
  games: number;
  wins: number; // the page hero's wins
  win_rate: number; // the page hero's win rate, %
}
/** data/matchups/<slug>.json — Storm League, one hero per file, collected every other day (collector/matchups.py). */
export interface MatchupsFile {
  hero: string;
  patch: string;
  game_type: string;
  collected_at: string;
  /** The hero's own record in the same sample. */
  games: number;
  wins: number;
  win_rate: number;
  ally: MatchupPair[];
  enemy: MatchupPair[];
}
export interface TalentTable {
  talents: Record<string, TalentInfo>;
}
