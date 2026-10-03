import type { Snapshot } from "./formula";
import { localizedPath, type Locale } from "./i18n/locale";
import { knownOnly } from "./lib/known";

export interface Meta {
  current_patch: string;
  previous_patch: string | null;
  /** The one patch the whole site shows (collector build_meta): the previous one while the current is thin in
   *  Quick Match or Storm League. Pages never decide it themselves. Absent in meta from before 2026-09-29. */
  reference_patch?: string;
  patch_started_at: string;
  collected_at: string;
  min_games_for_tier: number;
  /** Per snapshot file key (qm, sl, sl_low, qm_kr, …); `collected_at` is set since #14 (regions rotate, so their dates differ). */
  modes: Record<string, ModeSample>;
  /** The same for the files in previous/ on previous_patch (regions arrive there on their own days and by backfill).
   *  Absent in meta from before 2026-09-30. */
  previous_modes?: Record<string, ModeSample>;
}
export interface ModeSample {
  matches: number;
  heroes: number;
  /** Heroes over min_games_for_tier: the ones the table tiers. */
  heroes_ranked: number;
  /** Heroes over 200 games: the collector's patch-health count (reference patch), not the tier floor. */
  heroes_over_200: number;
  collected_at?: string;
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
    patches: p("/hots/patches/"),
    draft: (qs?: string) => p("/hots/draft/") + (qs ? `?${qs}` : ""),
    map: (slug: string) => p(`/hots/maps/${encodeURIComponent(slug)}/`),
  };
}

export type Mode = "qm" | "sl";
export type Bracket = "all" | "low" | "high";
/** Labels: messages common.modes / common.brackets / common.regions. Two brackets while the player base is small
 *  (owner, 2026-09-29): league_tier 1-4 / 5-6; grandmasters are inside master.
 *  What each bracket means in league tiers (1 bronze … 6 master). A file whose league_tier differs is another cohort. */
export const BRACKET_TIERS: Record<Bracket, number[] | null> = { all: null, low: [1, 2, 3, 4], high: [5, 6] };
export const BRACKETS: Bracket[] = ["all", "low", "high"];
/** Snapshot file key for a mode + bracket (brackets exist for Storm League only). */
/** Regions (#14): every view in every region, daily (owner 2026-10-02); the whole is their sum (CN closed in 2023).
 *  The in-game Asia server is HP's `KR`. */
export type Region = "all" | "kr" | "na" | "eu";
export const REGIONS: Region[] = ["all", "kr", "na", "eu"];
/** The `region` a file carries (HP's code); null = every region. */
export const REGION_CODE: Record<Region, string | null> = { all: null, kr: "KR", na: "NA", eu: "EU" };
/** Snapshot file key for a mode + bracket (Storm League only; QM ignores it) + region: `sl_low_kr`, `qm_na`, `sl`. */
export function snapshotKey(mode: Mode, bracket: Bracket, region: Region = "all"): string {
  const view = mode === "sl" && bracket !== "all" ? `sl_${bracket}` : mode;
  return region === "all" ? view : `${view}_${region}`;
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

/** A hero's matchups file (Storm League) on patch `patch` (the reference patch), or null: not collected (404) or
 *  collected for another patch. */
export async function loadMatchups(slug: string, patch: string): Promise<MatchupsFile | null> {
  const res = await fetch(`${base}matchups/${slug}.json`, { cache: "no-cache" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`matchups/${slug}.json: HTTP ${res.status}`);
  const file = (await res.json()) as MatchupsFile;
  return file.patch === patch ? file : null;
}

/** End-of-match awards by the game's key (data/awards.json, tools/build_awards.py). */
export interface AwardTable {
  awards: Record<string, { ko: string; en: string; icon: string }>;
}
export const loadAwards = (): Promise<AwardTable> => getJson<AwardTable>("awards.json");

/** A hero's talent names, icons and tooltips (data/talents/<slug>.json), or null when the hero has none. */
export async function loadTalents(slug: string): Promise<TalentTable | null> {
  const res = await fetch(`${base}talents/${slug}.json`);
  return res.ok ? ((await res.json()) as TalentTable) : null;
}

/** Which patch directory the site shows: meta.reference_patch, decided once by the collector. */
export function referencePatch(meta: Meta): PatchChoice {
  return meta.previous_patch && meta.reference_patch === meta.previous_patch ? "previous" : "current";
}

/** The reference patch's build id (meta.reference_patch; the current patch in meta from before it existed). */
export const referencePatchId = (meta: Meta): string => (referencePatch(meta) === "previous" ? meta.previous_patch! : meta.current_patch);

/** A per-patch file (talent builds, matchups) is shown only when it is on the reference patch — never another patch's. */
export const onReference = <T extends { patch: string }>(file: T | null, meta: Meta): T | null => (file && file.patch === referencePatchId(meta) ? file : null);

/** Right after a patch the current build is thin; fall back to the previous patch for that mode. */
/** `key`: a mode, or any snapshot file key (a region's file has its own sample size). */
export function thinSample(meta: Meta, key: string): boolean {
  return thin(meta.modes[key]);
}
const thin = (m: ModeSample | undefined): boolean => !!m?.heroes && m.heroes_ranked / m.heroes < 0.5;

/** A region's sample health and collection date on the patch a view shows; null = not collected on that patch yet. */
/** `shown`: the heroes on the site — the note's denominator. The file only has rows for heroes that played in it
 *  (KR 다마그 on 10-02: 6), which read as "0/6" when 91 heroes are on the page. */
export function regionSample(meta: Meta, mode: Mode, region: Region, patch: PatchChoice, bracket: Bracket = "all", shown?: number): { collectedAt: string | null; heroes: number; over: number; thin: boolean } | null {
  const m = (patch === "previous" ? meta.previous_modes : meta.modes)?.[snapshotKey(mode, bracket, region)];
  if (!m) return null;
  const heroes = Math.max(shown ?? 0, m.heroes);
  return { collectedAt: m.collected_at ?? null, heroes, over: m.heroes_ranked, thin: thin({ ...m, heroes }) };
}

/** "2026-09-28T04:07:19Z" → "09/28" */
/** MM/DD of a collection time on the Korean calendar (UTC+9, no DST): the daily run is at 03:20 KST,
 *  which is still the day before in UTC. */
export const shortDate = (iso: string): string => {
  const t = Date.parse(iso);
  const day = Number.isNaN(t) ? iso : new Date(t + 9 * 3600_000).toISOString();
  return day.slice(5, 10).replace("-", "/");
};

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
/** data/patchnotes.json — Blizzard's official live/balance notes, parsed by collector/patchnotes.py (#62). */
export type PatchDirection = "up" | "down" | "neutral";
export type PatchVerdict = "buff" | "nerf" | "mixed";
export interface PatchNotesFile {
  parser: number;
  fetched_at: string;
  /** newest first */
  notes: PatchNote[];
}
export interface PatchNote {
  id: string;
  published: string;
  /** the first build HP listed around the note; null until it is listed */
  build: string | null;
  title: { ko: string; en: string };
  url: { ko: string; en: string };
  /** by API hero name */
  heroes: Record<string, { verdict: PatchVerdict; groups: PatchGroup[] }>;
}
export interface PatchGroup {
  section: "base" | "talents";
  level: number | null;
  ability: { ko: string; en: string | null } | null;
  changes: { ko: string; en: string | null; direction: PatchDirection }[];
}
/** data/hotfixes.json — builds shipped without notes, their changed talent numbers (collector/hotfixes.py, #62). */
export interface HotfixesFile {
  /** newest build first */
  builds: Hotfix[];
}
export interface Hotfix {
  build: string;
  previous: string;
  /** when the build first appeared on Blizzard's CDN */
  first_seen: string;
  parser: number;
  /** by API hero name: base stats first, then abilities, then talents (collector/hotfixes.py) */
  heroes: Record<string, HotfixItem[]>;
}
type Words = { ko: string; en: string };
export interface HotfixItem {
  kind: "base" | "ability" | "talent";
  id: string;
  /** null for the base item: each change carries its stat's word instead */
  ko: string | null;
  en: string | null;
  /** abilities: Q W E R D */
  key?: string;
  changes: { old: string; new: string; label?: Words }[];
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
