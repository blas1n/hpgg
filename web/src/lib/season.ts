/** 이번 시즌 card (owner 2026-10-14, like LoL search sites' season sidebar): a player's heroes most played first, with
 *  win rate and KDA, the totals, and the record per role.
 *  - Storm League: GET /v1/players/season (server/players/season.py) — HP /players/heroes for the current season,
 *    every game HP has, cached as long as the match list.
 *  - Quick Match has no seasons: the newest games of the match list the page already has, so it asks nothing more.
 *  Per role is the heroes' games added up by each hero's role; HP's /players/roles (25 a week) is not asked. */
import type { HeroInfo, HeroTable } from "../data";
import { localizedPath, type Locale } from "../i18n/locale";
import type { MatchRow } from "./matches";
import { apiGet, type ApiResult, type FetchOptions, type Region } from "./players";

// --- API shape (server/players/season.py) ---
export interface SeasonHero {
  hero: string;
  short_name: string | null;
  role: string | null;
  games: number;
  wins: number;
  losses: number;
  /** season sums; null for games without a stat line (Quick Match from the MMR history) */
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  takedowns: number | null;
  /** the game card's stat line as season sums (owner 2026-10-14); absent in answers from before it was sent */
  hero_damage?: number | null;
  siege_damage?: number | null;
  healing?: number | null;
  damage_taken?: number | null;
  experience?: number | null;
}
export interface SeasonResponse {
  season: number;
  mode: "sl";
  heroes: SeasonHero[];
  fetched_at: string;
  stale: boolean;
  notice: string | null;
}
export type SeasonResult = ApiResult<SeasonResponse>;

const isSeason = (b: unknown): b is SeasonResponse => typeof b === "object" && b !== null && Array.isArray((b as SeasonResponse).heroes);

export const fetchSeason = (battletag: string, region: Region, opts: FetchOptions = {}): Promise<SeasonResult> =>
  // a cold query waits on Heroes Profile's job (server polls up to 25 s)
  apiGet("/v1/players/season", { battletag, region }, isSeason, { timeoutMs: 30_000, ...opts });

// --- view ---
export interface SeasonHeroView {
  name: string;
  slug: string | null;
  portrait?: string;
  role?: string;
  href: string | null;
  games: number;
  wins: number;
  winRate: number;
  kda: number | null;
  perGame: { kills: number; deaths: number; assists: number } | null;
  /** per game over the season: what a game card shows; null without a stat line */
  stats: { heroDamage: number; siegeDamage: number; healing: number; damageTaken: number; experience: number } | null;
}
export interface SeasonCardView {
  games: number;
  wins: number;
  losses: number;
  winRate: number | null;
  kda: number | null;
  /** takedowns per game */
  takedowns: number | null;
  heroes: SeasonHeroView[];
  roles: { role: string; label: string; games: number; wins: number; winRate: number | null }[];
}

/** (K + A) / D; a game without deaths counts its takedowns, as the game does. */
const ratio = (k: number, d: number, a: number) => (d === 0 ? k + a : (k + a) / d);
const lined = (r: SeasonHero) => r.kills !== null && r.deaths !== null && r.assists !== null;
const num = (x: number | null | undefined): x is number => typeof x === "number";
const statted = (r: SeasonHero) => num(r.hero_damage) && num(r.siege_damage) && num(r.damage_taken) && num(r.experience);

export function seasonCard(rows: SeasonHero[], heroes: HeroTable, locale: Locale): SeasonCardView {
  const byKey = new Map<string, HeroInfo>();
  for (const h of heroes.heroes) {
    byKey.set(h.name, h);
    if (h.short_name) byKey.set(h.short_name, h);
  }
  const info = (r: SeasonHero) => (r.short_name && byKey.get(r.short_name)) || byKey.get(r.hero);
  const sorted = [...rows].sort((a, b) => b.games - a.games || b.wins - a.wins || a.hero.localeCompare(b.hero));
  const sum = (f: (r: SeasonHero) => number | null) => sorted.reduce((n, r) => n + (f(r) ?? 0), 0);
  const games = sum((r) => r.games);
  const wins = sum((r) => r.wins);
  const full = sorted.length > 0 && sorted.every(lined);
  const roleOf = (r: SeasonHero) => r.role ?? info(r)?.role ?? null;
  return {
    games,
    wins,
    losses: sum((r) => r.losses),
    winRate: games ? (wins / games) * 100 : null,
    kda: full ? ratio(sum((r) => r.kills), sum((r) => r.deaths), sum((r) => r.assists)) : null,
    takedowns: full && games ? sum((r) => r.takedowns) / games : null,
    heroes: sorted.map((r) => {
      const h = info(r);
      return {
        name: h?.ko ?? r.hero,
        slug: h?.slug ?? null,
        portrait: h?.portrait,
        role: h?.role,
        href: h ? localizedPath(`/hots/heroes/${h.slug}/`, locale) : null,
        games: r.games,
        wins: r.wins,
        winRate: r.games ? (r.wins / r.games) * 100 : 0,
        kda: lined(r) ? ratio(r.kills!, r.deaths!, r.assists!) : null,
        perGame: lined(r) && r.games ? { kills: r.kills! / r.games, deaths: r.deaths! / r.games, assists: r.assists! / r.games } : null,
        stats:
          statted(r) && r.games
            ? {
                heroDamage: r.hero_damage! / r.games,
                siegeDamage: r.siege_damage! / r.games,
                healing: (r.healing ?? 0) / r.games,
                damageTaken: r.damage_taken! / r.games,
                experience: r.experience! / r.games,
              }
            : null,
      };
    }),
    roles: heroes.roles.map((x) => {
      const of = sorted.filter((r) => roleOf(r) === x.name);
      const g = of.reduce((n, r) => n + r.games, 0);
      const w = of.reduce((n, r) => n + r.wins, 0);
      return { role: x.name, label: x.ko, games: g, wins: w, winRate: g ? (w / g) * 100 : null };
    }),
  };
}

/** Quick Match from the match list: its games per hero, then the same card. */
export function qmCard(matches: MatchRow[], heroes: HeroTable, locale: Locale): SeasonCardView {
  const by = new Map<string, SeasonHero>();
  const add = (a: number | null, b: number | null) => (a === null || b === null ? null : a + b);
  for (const m of matches) {
    if (m.mode !== "qm" || m.win === null) continue;
    const k = m.short_name ?? m.hero;
    const zero = { kills: 0, deaths: 0, assists: 0, takedowns: 0, hero_damage: 0, siege_damage: 0, healing: 0, damage_taken: 0, experience: 0 };
    const r: SeasonHero = by.get(k) ?? { hero: m.hero, short_name: m.short_name, role: m.role, games: 0, wins: 0, losses: 0, ...zero };
    // a game with a stat line sends no healing for a non-healer: none, not unknown
    const line = m.kills !== null;
    by.set(k, {
      ...r,
      games: r.games + 1,
      wins: r.wins + (m.win ? 1 : 0),
      losses: r.losses + (m.win ? 0 : 1),
      kills: add(r.kills, m.kills),
      deaths: add(r.deaths, m.deaths),
      assists: add(r.assists, m.assists),
      takedowns: add(r.takedowns, m.takedowns),
      hero_damage: add(r.hero_damage ?? null, m.hero_damage),
      siege_damage: add(r.siege_damage ?? null, m.siege_damage),
      healing: add(r.healing ?? null, line ? (m.healing ?? 0) : null),
      damage_taken: add(r.damage_taken ?? null, m.damage_taken),
      experience: add(r.experience ?? null, m.experience),
    });
  }
  return seasonCard([...by.values()], heroes, locale);
}
