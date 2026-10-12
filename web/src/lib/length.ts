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
  bands: { band: LengthBand; games: number; winRate: number | null }[];
  lean: "early" | "late" | null;
}

export function lengthView(file: LengthFile | null, heroName: string, window: MetaWindow | undefined): LengthView | null {
  const h = file?.heroes[heroName];
  if (!file || !h) return null;
  const bands = LENGTH_BANDS.map((band) => {
    const { games, wins } = h[band];
    return { band, games, winRate: games >= LENGTH_MIN_GAMES ? (wins / games) * 100 : null };
  });
  return {
    patch: file.patch,
    collectedAt: file.collected_at,
    sample: file.games,
    games: bands.reduce((n, b) => n + b.games, 0),
    sinceDay: file.since && window?.since === file.since && window.since_at ? kstDay(window.since_at) : null,
    bands,
    lean: h.lean,
  };
}
