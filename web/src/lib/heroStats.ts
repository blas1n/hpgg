/** A player's stats per hero (전적 검색, #88), worked out from the match list the page already has (owner 2026-10-09):
 *  Heroes Profile's /players/heroes spends a 500-a-week bucket per player and mode, while the newest games
 *  (up to 100, /v1/players/matches) cost nothing more and split by mode for free. A basic list (no stat lines)
 *  still gives games and win rate. */
import type { HeroInfo, HeroTable } from "../data";
import { localizedPath, type Locale } from "../i18n/locale";
import type { MatchRow } from "./matches";

export type HeroStatsMode = "all" | "qm" | "sl";
export const HERO_STATS_MODES: HeroStatsMode[] = ["all", "qm", "sl"];

export interface HeroStatsRow {
  hero: string;
  short_name: string | null;
  games: number;
  wins: number;
  losses: number;
  win_rate: number;
  /** per game over the games with a stat line; null when none has one */
  kda: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  hero_damage: number | null;
  siege_damage: number | null;
  healing: number | null;
  damage_taken: number | null;
  experience: number | null;
}

type Stat = "kills" | "deaths" | "assists" | "hero_damage" | "siege_damage" | "healing" | "damage_taken" | "experience";
const STATS: Stat[] = ["kills", "deaths", "assists", "hero_damage", "siege_damage", "healing", "damage_taken", "experience"];

/** The match list → one row per hero, most played first. */
export function heroRowsFromMatches(rows: MatchRow[], mode: HeroStatsMode): HeroStatsRow[] {
  const by = new Map<string, MatchRow[]>();
  for (const m of rows) {
    if (mode !== "all" && m.mode !== mode) continue;
    const k = m.short_name ?? m.hero;
    by.set(k, [...(by.get(k) ?? []), m]);
  }
  const out: HeroStatsRow[] = [];
  for (const games of by.values()) {
    const wins = games.filter((g) => g.win === true).length;
    const losses = games.filter((g) => g.win === false).length;
    const avg = (k: Stat): number | null => {
      const v = games.map((g) => g[k]).filter((x): x is number => typeof x === "number");
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const st = Object.fromEntries(STATS.map((k) => [k, avg(k)])) as Record<Stat, number | null>;
    const lined = games.filter((g) => g.kills !== null && g.deaths !== null && g.assists !== null);
    const sum = (k: "kills" | "deaths" | "assists") => lined.reduce((a, g) => a + (g[k] ?? 0), 0);
    out.push({
      hero: games[0]!.hero,
      short_name: games[0]!.short_name,
      games: games.length,
      wins,
      losses,
      win_rate: wins + losses ? (wins / (wins + losses)) * 100 : 0,
      kda: lined.length ? (sum("kills") + sum("assists")) / Math.max(1, sum("deaths")) : null,
      ...st,
    });
  }
  return out.sort((a, b) => b.games - a.games || a.hero.localeCompare(b.hero));
}

export interface HeroStatsLine {
  name: string;
  slug: string | null;
  portrait?: string;
  role?: string;
  href: string | null;
  games: number;
  winRate: number;
  kda: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  heroDamage: number | null;
  siegeDamage: number | null;
  healing: number | null;
  damageTaken: number | null;
  experience: number | null;
}

/** Rows → the page's lines, in the rows' order (most played first); `heroes` in the page language. */
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
