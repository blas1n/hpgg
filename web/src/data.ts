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
}
export interface HeroTable {
  roles: { name: string; ko: string }[];
  heroes: HeroInfo[];
}
export interface MapTable {
  maps: { name: string; ko: string; slug: string }[];
}

export type Mode = "qm" | "sl";
export type PatchChoice = "current" | "previous";

const base = import.meta.env.BASE_URL;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(base + path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const loadMeta = (): Promise<Meta> => getJson<Meta>("latest/meta.json");
export const loadHeroes = (): Promise<HeroTable> => getJson<HeroTable>("heroes_ko.json");
export const loadMaps = (): Promise<MapTable> => getJson<MapTable>("maps_ko.json");
export const loadSnapshot = (mode: Mode, patch: PatchChoice): Promise<Snapshot> =>
  getJson<Snapshot>(`${patch === "previous" ? "previous" : "latest"}/${mode}.json`);

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
