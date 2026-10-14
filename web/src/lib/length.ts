/** 게임 시간대별 승률 (roadmap stage 2): a hero's Storm League win rate by game length, from the replay sample of the
 *  patch's window (collector/hero_length.py, data/latest/sl_length.json). Pure. */
import { kstDay, type MetaWindow } from "./window";

export type LengthBand = "short" | "mid" | "long";
export const LENGTH_BANDS: LengthBand[] = ["short", "mid", "long"];
/** A band under this many of the hero's games shows no rate (the weekly report's rule: no claim under 30 games). */
export const LENGTH_MIN_GAMES = 30;

interface Count {
  games: number;
  wins: number;
}
export interface LengthFile {
  patch: string;
  /** The balance hotfix the count starts from, or null: the whole patch. */
  since: string | null;
  collected_at: string;
  games: number;
  bands: Record<LengthBand, number>;
  /** `lean`: the collector's verdict — short and long games differ beyond the error (z ≥ 1.96, 30+ games each). */
  heroes: Record<string, Record<LengthBand, Count> & { lean: "early" | "late" | null }>;
}

export interface LengthView {
  patch: string;
  collectedAt: string;
  /** Storm League games in the sample. */
  sample: number;
  /** The hero's games in it. */
  games: number;
  /** M/D (Korean time) of the hotfix the count starts from, or null. */
  sinceDay: string | null;
  /** The hero's rate over all three bands: what a band is compared with (every band's all-hero average is 50%, as every
   *  game has five winners and five losers; asked 2026-10-14). */
  heroRate: number;
  /** `vsHero`: the band's rate minus heroRate, in %p; null with no rate. */
  bands: { band: LengthBand; games: number; winRate: number | null; vsHero: number | null }[];
  lean: "early" | "late" | null;
}

export function lengthView(file: LengthFile | null, heroName: string, window: MetaWindow | undefined): LengthView | null {
  const h = file?.heroes[heroName];
  if (!file || !h) return null;
  const games = LENGTH_BANDS.reduce((n, b) => n + h[b].games, 0);
  const heroRate = games ? (LENGTH_BANDS.reduce((n, b) => n + h[b].wins, 0) / games) * 100 : 50;
  const bands = LENGTH_BANDS.map((band) => {
    const { games: n, wins } = h[band];
    const winRate = n >= LENGTH_MIN_GAMES ? (wins / n) * 100 : null;
    return { band, games: n, winRate, vsHero: winRate === null ? null : winRate - heroRate };
  });
  return {
    patch: file.patch,
    collectedAt: file.collected_at,
    sample: file.games,
    games,
    heroRate,
    sinceDay: file.since && window?.since === file.since && window.since_at ? kstDay(window.since_at) : null,
    bands,
    lean: h.lean,
  };
}
