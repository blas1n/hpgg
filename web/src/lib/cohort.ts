/** Two snapshots describe the same population only if they cover the same league tiers. When the bracket
 *  definition changes (2026-09-28: 1-2/3-4/5-6 → 1-3/4-5/6), previous-patch files of a bracket are a different
 *  cohort and must not be used for ▲▼ deltas. */
export function sameCohort(a: { league_tier: number[] | null }, b: { league_tier: number[] | null }): boolean {
  const key = (t: number[] | null) => (t ? [...t].sort((x, y) => x - y).join(",") : "all");
  return key(a.league_tier) === key(b.league_tier);
}
