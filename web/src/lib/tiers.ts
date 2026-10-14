/** 티어별 승률 (owner 2026-10-13): a hero's Storm League win rate in each league, bronze to master, party-corrected like
 *  every win rate the site shows (collector/tiers.py, data/latest/sl_tiers.json). Pure. */
import { wilson } from "../wilson";

/** League tier ids 1…6 (HP has no grandmaster id: grandmasters are inside master); keys of messages hero.tiersLeagues. */
export const TIER_LEAGUES = ["bronze", "silver", "gold", "platinum", "diamond", "master"] as const;
export type TierLeague = (typeof TIER_LEAGUES)[number];
/** A point under this many games is drawn faint: its interval is wider than most differences between tiers. */
export const TIER_MIN_GAMES = 30;

interface TierRow {
  games: number;
  wins: number;
  win_rate: number;
  tier_win_rate: number;
}
export interface TiersFile {
  patch: string;
  since: string | null;
  collected_at: string;
  tiers: number[];
  matches: (number | null)[];
  heroes: Record<string, (TierRow | null)[]>;
}

export interface TierPoint {
  league: TierLeague;
  games: number;
  /** Party-corrected win rate; null when the hero has no games in the league. */
  winRate: number | null;
  /** The 95% interval of the win rate, moved with the correction. */
  low: number | null;
  high: number | null;
  thin: boolean;
  /** The league's all-hero average (games-weighted, corrected): not 50%, as players of a higher league beat lower ones in
   *  the same games (bronze 46.9 %, master+ 53.7 % on 2.57.0, asked 2026-10-14). */
  average: number | null;
  /** winRate minus average, in %p; null with no rate. */
  vsAverage: number | null;
}
export interface TiersView {
  patch: string;
  collectedAt: string;
  games: number;
  points: TierPoint[];
}

export function tiersView(file: TiersFile | null, heroName: string): TiersView | null {
  const rows = file?.heroes[heroName];
  if (!file || !rows) return null;
  const averages = TIER_LEAGUES.map((_, i) => {
    let games = 0;
    let sum = 0;
    for (const hero of Object.values(file.heroes)) {
      const r = hero[i];
      if (r && r.games) {
        games += r.games;
        sum += r.tier_win_rate * r.games;
      }
    }
    return games ? sum / games : null;
  });
  const points = TIER_LEAGUES.map((league, i): TierPoint => {
    const r = rows[i];
    const average = averages[i] ?? null;
    if (!r || !r.games) return { league, games: 0, winRate: null, low: null, high: null, thin: true, average, vsAverage: null };
    const [lo, hi] = wilson(r.wins, r.games);
    const shift = r.tier_win_rate - (r.wins / r.games) * 100;
    return {
      league,
      games: r.games,
      winRate: r.tier_win_rate,
      low: lo + shift,
      high: hi + shift,
      thin: r.games < TIER_MIN_GAMES,
      average,
      vsAverage: average === null ? null : r.tier_win_rate - average,
    };
  });
  return { patch: file.patch, collectedAt: file.collected_at, games: points.reduce((n, p) => n + p.games, 0), points };
}
