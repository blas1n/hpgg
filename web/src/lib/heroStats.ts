/** A player's stats per hero (전적 검색, #88): GET /v1/players/heroes?mode=all|qm|sl (server/players/heroes.py,
 *  Heroes Profile /players/heroes) — every game the player has on Heroes Profile, one row per hero. */
import type { HeroInfo, HeroTable } from "../data";
import { localizedPath, type Locale } from "../i18n/locale";
import { apiGet, type ApiResult, type FetchOptions, type Notice, type Region } from "./players";

export type HeroStatsMode = "all" | "qm" | "sl";
export const HERO_STATS_MODES: HeroStatsMode[] = ["all", "qm", "sl"];

// --- API shape (server/players/heroes.py hero_rows) ---
export interface HeroStatsRow {
  hero: string;
  short_name: string | null;
  games: number;
  wins: number;
  losses: number;
  win_rate: number;
  kda: number;
  kills: number;
  deaths: number;
  assists: number;
  hero_damage: number;
  siege_damage: number;
  healing: number;
  damage_taken: number;
  experience: number;
}
export interface HeroStatsResponse {
  mode: HeroStatsMode;
  heroes: HeroStatsRow[];
  fetched_at: string;
  stale: boolean;
  notice: Notice | null;
}

const isHeroStats = (b: unknown): b is HeroStatsResponse => typeof b === "object" && b !== null && Array.isArray((b as HeroStatsResponse).heroes);

export const fetchHeroStats = (battletag: string, region: Region, mode: HeroStatsMode, opts: FetchOptions = {}): Promise<ApiResult<HeroStatsResponse>> =>
  // a cold query waits on Heroes Profile's job (server polls up to 20 s)
  apiGet("/v1/players/heroes", { battletag, region, mode }, isHeroStats, { timeoutMs: 30_000, ...opts });

export interface HeroStatsLine {
  name: string;
  slug: string | null;
  portrait?: string;
  role?: string;
  href: string | null;
  games: number;
  winRate: number;
  kda: number;
  kills: number;
  deaths: number;
  assists: number;
  heroDamage: number;
  siegeDamage: number;
  healing: number;
  damageTaken: number;
  experience: number;
}

/** API rows → the page's lines, in the API's order (most played first); `heroes` in the page language. */
export function heroStatsView(rows: HeroStatsRow[], heroes: HeroTable, locale: Locale): HeroStatsLine[] {
  const by = new Map<string, HeroInfo>();
  for (const h of heroes.heroes) {
    if (h.short_name) by.set(h.short_name, h);
    by.set(h.name, h);
  }
  return rows.map((r) => {
    const h = (r.short_name && by.get(r.short_name)) || by.get(r.hero);
    return {
      name: h?.ko ?? r.hero,
      slug: h?.slug ?? null,
      portrait: h?.portrait,
      role: h?.role,
      href: h ? localizedPath(`/hots/heroes/${h.slug}/`, locale) : null,
      games: r.games,
      winRate: r.win_rate,
      kda: r.kda,
      kills: r.kills,
      deaths: r.deaths,
      assists: r.assists,
      heroDamage: r.hero_damage,
      siegeDamage: r.siege_damage,
      healing: r.healing,
      damageTaken: r.damage_taken,
      experience: r.experience,
    };
  });
}
