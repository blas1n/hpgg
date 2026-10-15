/** Counters and synergies on the hero page. Pure: computed at build time from data/matchups/<slug>.json.
 *
 *  score = (pair win rate − expected) × n / (n + k)   — the tier formula's shrinkage, applied to the gap
 *  expected = the hero's own win rate ± (the other hero's own Storm League win rate − 50): with a strong ally or against
 *  a weak enemy a hero wins more anyway, and that is the other hero's strength, not a synergy or a counter (owner
 *  2026-10-15: the unadjusted gap correlated 0.37–0.56 with the heroes' own strength; adjusted, 0.0). pairExpected.
 *  pairs with fewer than MATCHUP_MIN_GAMES games are left out; the rule is printed on the page (matchupRule).
 *  Both lists keep only pairs beyond the error (beyondError): of the pairs over 50 games only 8.7 % of enemy and 8.4 %
 *  of ally pairs were, against 5 % by chance alone, so most listed pairs were chance (owner 2026-10-15). */
import type { HeroTable, MatchupPair, MatchupsFile } from "../data";
import type { Snapshot } from "../formula";
import type { Locale } from "../i18n/locale";
import { messages } from "../i18n/messages";

export const MATCHUP_K = 100;
export const MATCHUP_MIN_GAMES = 50;
export const MATCHUP_TOP = 5;
/** Two-sided 95 %. */
export const MATCHUP_Z = 1.96;
/** The ordering rule as printed on the page. */
export const matchupRule = (locale: Locale): string => messages[locale].hero.matchupRule(String(MATCHUP_K), String(MATCHUP_MIN_GAMES));

export const matchupScore = (pairWinRate: number, ownWinRate: number, games: number): number =>
  (pairWinRate - ownWinRate) * (games / (games + MATCHUP_K));

/** The pair rate differs from the hero's own rate by more than MATCHUP_Z standard errors on the pair's games. */
export function beyondError(pairWinRate: number, ownWinRate: number, games: number): boolean {
  const p = ownWinRate / 100;
  const se = Math.sqrt((p * (1 - p)) / games) * 100;
  return games > 0 && se > 0 && Math.abs(pairWinRate - ownWinRate) / se >= MATCHUP_Z;
}

/** Each hero's own all-map win rate in a snapshot (the shown Storm League one): the strength pairExpected takes out. */
export function heroStrength(snap: Snapshot | null): Map<string, number> {
  return new Map((snap?.rows ?? []).filter((r) => r.map === "all" && r.games > 0).map((r) => [r.hero, r.win_rate]));
}

/** What a hero at `own` % wins with (ally) or against (enemy) a hero at `other` % on their own strengths alone. */
export function pairExpected(own: number, other: number | undefined, side: "ally" | "enemy"): number {
  const lift = (other ?? 50) - 50;
  return side === "ally" ? own + lift : own - lift;
}

export interface MatchupRow {
  hero: string;
  slug?: string; // absent for a hero the site has no page for yet
  ko: string;
  portrait?: string;
  games: number;
  win_rate: number;
  /** What the hero would win on the two heroes' own strengths (pairExpected), %. */
  expected: number;
  /** pair win rate − expected, %p (not shrunk: the number people can check). */
  delta: number;
  score: number;
}

export interface MatchupsView {
  patch: string;
  collectedAt: string;
  win_rate: number;
  games: number;
  /** Enemies this hero loses to most, worst first. */
  counters: MatchupRow[];
  /** Allies this hero wins with most, best first. */
  synergies: MatchupRow[];
}

/** `strength`: each hero's own Storm League win rate (the shown snapshot); a hero missing from it is not adjusted. */
export function matchupsView(file: MatchupsFile | null, heroes: HeroTable, strength?: ReadonlyMap<string, number>): MatchupsView | null {
  if (!file) return null;
  const info = new Map(heroes.heroes.map((h) => [h.name, h]));
  const rows = (pairs: MatchupPair[], side: "ally" | "enemy"): MatchupRow[] =>
    pairs
      .filter((p) => p.games >= MATCHUP_MIN_GAMES)
      .map((p) => {
        const h = info.get(p.hero);
        const expected = pairExpected(file.win_rate, strength?.get(p.hero), side);
        return { hero: p.hero, slug: h?.slug, ko: h?.ko ?? p.hero, portrait: h?.portrait, games: p.games, win_rate: p.win_rate, expected, delta: p.win_rate - expected, score: matchupScore(p.win_rate, expected, p.games) };
      });
  return {
    patch: file.patch,
    collectedAt: file.collected_at,
    win_rate: file.win_rate,
    games: file.games,
    counters: rows(file.enemy, "enemy").filter((r) => r.score < 0 && beyondError(r.win_rate, r.expected, r.games)).sort((a, b) => a.score - b.score).slice(0, MATCHUP_TOP),
    synergies: rows(file.ally, "ally").filter((r) => r.score > 0 && beyondError(r.win_rate, r.expected, r.games)).sort((a, b) => b.score - a.score).slice(0, MATCHUP_TOP),
  };
}
