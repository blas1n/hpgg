/** Counters and synergies on the hero page. Pure: computed at build time from data/matchups/<slug>.json.
 *
 *  score = (pair win rate − the hero's own win rate) × n / (n + k)   — the tier formula's shrinkage, applied to the gap
 *  pairs with fewer than MATCHUP_MIN_GAMES games are left out; the rule is printed on the page (matchupRule). */
import type { HeroTable, MatchupPair, MatchupsFile } from "../data";
import type { Locale } from "../i18n/locale";
import { messages } from "../i18n/messages";

export const MATCHUP_K = 100;
export const MATCHUP_MIN_GAMES = 50;
export const MATCHUP_TOP = 5;
/** The ordering rule as printed on the page. */
export const matchupRule = (locale: Locale): string => messages[locale].hero.matchupRule(String(MATCHUP_K), String(MATCHUP_MIN_GAMES));

export const matchupScore = (pairWinRate: number, ownWinRate: number, games: number): number =>
  (pairWinRate - ownWinRate) * (games / (games + MATCHUP_K));

export interface MatchupRow {
  hero: string;
  slug?: string; // absent for a hero the site has no page for yet
  ko: string;
  portrait?: string;
  games: number;
  win_rate: number;
  /** pair win rate − the hero's own win rate, %p (not shrunk: the number people can check). */
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

export function matchupsView(file: MatchupsFile | null, heroes: HeroTable): MatchupsView | null {
  if (!file) return null;
  const info = new Map(heroes.heroes.map((h) => [h.name, h]));
  const rows = (pairs: MatchupPair[]): MatchupRow[] =>
    pairs
      .filter((p) => p.games >= MATCHUP_MIN_GAMES)
      .map((p) => {
        const h = info.get(p.hero);
        return { hero: p.hero, slug: h?.slug, ko: h?.ko ?? p.hero, portrait: h?.portrait, games: p.games, win_rate: p.win_rate, delta: p.win_rate - file.win_rate, score: matchupScore(p.win_rate, file.win_rate, p.games) };
      });
  return {
    patch: file.patch,
    collectedAt: file.collected_at,
    win_rate: file.win_rate,
    games: file.games,
    counters: rows(file.enemy).filter((r) => r.score < 0).sort((a, b) => a.score - b.score).slice(0, MATCHUP_TOP),
    synergies: rows(file.ally).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, MATCHUP_TOP),
  };
}
