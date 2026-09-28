import type { Snapshot } from "./formula";

export interface Meta {
  current_patch: string;
  previous_patch: string | null;
  patch_started_at: string;
  collected_at: string;
  min_games_for_tier: number;
  modes: Record<string, { matches: number; heroes: number; heroes_over_200: number }>;
}

export interface HeroInfo {
  name: string;
  slug: string;
  ko: string;
  role: string;
  role_ko: string;
  portrait?: string; // e.g. img/heroes/qhira.png (relative to the site root)
}
export interface HeroTable {
  roles: { name: string; ko: string }[];
  heroes: HeroInfo[];
}
export interface MapTable {
  maps: { name: string; ko: string; slug: string; image?: string }[];
}

/** data/ is published at the site root (https://hpgg.win/latest/…, /img/…). */
const base = "/";
export const assetUrl = (rel: string): string => base + rel;

/** Site routes for the Heroes of the Storm section. */
export const hotsHref = {
  home: "/hots/",
  tier: (qs?: URLSearchParams | string) => `/hots/tier/${qs && String(qs) ? `?${String(qs)}` : ""}`,
  heroes: "/hots/heroes/",
  hero: (slug: string, mode?: Mode) => `/hots/heroes/${encodeURIComponent(slug)}/${mode === "sl" ? "?mode=sl" : ""}`,
  maps: "/hots/maps/",
};

export type Mode = "qm" | "sl";
export const MODE_LABEL: Record<Mode, string> = { qm: "빠른 대전", sl: "폭풍 리그" };
export type Bracket = "all" | "low" | "high";
/** Two brackets while the player base is small (owner, 2026-09-29): league_tier 1-4 / 5-6; grandmasters are inside master. */
export const BRACKET_LABEL: Record<Bracket, string> = { all: "전체 구간", low: "브론즈 – 플래티넘", high: "다이아 – 그랜드마스터" };
/** Snapshot file key for a mode + bracket (brackets exist for Storm League only). */
export const snapshotKey = (mode: Mode, bracket: Bracket): string => (mode === "sl" && bracket !== "all" ? `sl_${bracket}` : mode);
export type PatchChoice = "current" | "previous";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(base + path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const loadMeta = (): Promise<Meta> => getJson<Meta>("latest/meta.json");
export const loadHeroes = (): Promise<HeroTable> => getJson<HeroTable>("heroes_ko.json");
export const loadMaps = (): Promise<MapTable> => getJson<MapTable>("maps_ko.json");
export const loadSnapshot = (key: string, patch: PatchChoice): Promise<Snapshot> =>
  getJson<Snapshot>(`${patch === "previous" ? "previous" : "latest"}/${key}.json`);

/** Right after a patch the current build is thin; fall back to the previous patch for that mode. */
export function thinSample(meta: Meta, mode: Mode): boolean {
  const m = meta.modes[mode];
  if (!m || !m.heroes) return false;
  return m.heroes_over_200 / m.heroes < 0.5;
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
export interface TalentTable {
  talents: Record<string, { ko: string; icon: string }>;
}
export const loadBuilds = (): Promise<BuildsFile | null> => getJson<BuildsFile>("latest/builds.json").catch(() => null);
export const loadTalents = (): Promise<TalentTable | null> => getJson<TalentTable>("talents_ko.json").catch(() => null);
