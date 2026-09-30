/** Summary lines at the top of the hero page (#37): template sentences built from numbers the page already has —
 *  never prose. Each line carries its number; a line with nothing to say beyond the stat cards is left out. */
import type { HeroSummary, MapRow } from "./hero";
import type { MatchupRow, MatchupsView } from "./matchups";

export type SummaryLine =
  /** win rate − the previous patch's win rate, %p (only where the hero was ranked on both). */
  | { key: "change"; wrChange: number }
  /** the best map with enough games (maps come best first). */
  | { key: "map"; map: { slug: string; ko: string; win_rate: number } }
  | { key: "watch"; hero: MatchupRow }
  | { key: "pair"; hero: MatchupRow };

export function summaryLines(summary: HeroSummary, maps: MapRow[], matchups: MatchupsView | null): SummaryLine[] {
  const lines: SummaryLine[] = [];
  if (summary.kind === "ranked") {
    if (summary.prevWinRate !== null) lines.push({ key: "change", wrChange: summary.win_rate - summary.prevWinRate });
    const m = maps.find((x) => !x.thin);
    if (m) lines.push({ key: "map", map: { slug: m.slug, ko: m.ko, win_rate: m.win_rate } });
  }
  const counter = matchups?.counters[0];
  if (counter) lines.push({ key: "watch", hero: counter });
  const ally = matchups?.synergies[0];
  if (ally) lines.push({ key: "pair", hero: ally });
  return lines;
}
