/** 영웅별 주요 스탯 (owner 2026-10-12): the stats a hero stands out on, beyond the card's stat line.
 * Picked daily from the replay records (data/identity_stats.json, collector/identity_stats.py: at least 1.5 times
 * all heroes' average, up to three); each game card shows the game's own value against the hero's average per game. */
import type { IdentityStats } from "../data";
import type { Locale } from "../i18n/locale";
import type { MatchRow } from "./matches";

/** The match row fields the collector may pick (collector/identity_stats.py CANDIDATES): what the card's numbers do
 *  not show (owner 2026-10-13). */
export const IDENTITY_STATS = ["stuns", "roots", "silences", "self_healing", "shields", "clutch_heals"] as const;
export type IdentityStat = (typeof IDENTITY_STATS)[number];

/** Seconds in the score line. */
const TIMES = new Set<IdentityStat>(["stuns", "roots", "silences"]);
const known = (s: string): s is IdentityStat => (IDENTITY_STATS as readonly string[]).includes(s);

export interface IdentityView {
  stat: IdentityStat;
  value: number;
  /** % above (+) or below (−) the hero's average per game; null when that average is 0 */
  vs: number | null;
}

/** The game's identity stats; none for a hero without any, a row without a stat line, or before the table loads. */
export function identityOf(m: MatchRow, table: IdentityStats | null): IdentityView[] {
  const picks = table?.heroes[m.hero]?.stats ?? [];
  return picks.flatMap(({ stat, avg }) => {
    const value = known(stat) ? m[stat] : null;
    if (!known(stat) || typeof value !== "number") return [];
    return [{ stat, value, vs: avg > 0 ? Math.round((value / avg - 1) * 100) : null }];
  });
}

export function identityValue(stat: IdentityStat, value: number, locale: Locale): string {
  if (TIMES.has(stat)) {
    const s = Math.round(value);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  return Math.round(value).toLocaleString(locale === "ko" ? "ko-KR" : "en-US");
}
