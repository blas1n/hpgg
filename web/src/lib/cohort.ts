/** Two snapshots describe the same population only if they cover the same league tiers and the same region. When the
 *  bracket definition changes (2026-09-28/29: 1-2/3-4/5-6 → 1-4/5-6), previous-patch files of a bracket are a different
 *  cohort and must not be used for ▲▼ deltas; a region file is never compared with another region or the global file. */
export function sameCohort(a: { league_tier: number[] | null; region?: string | null }, b: { league_tier: number[] | null; region?: string | null }): boolean {
  const key = (t: number[] | null, r: string | null | undefined) => `${t ? [...t].sort((x, y) => x - y).join(",") : "all"}|${r ?? "all"}`;
  return key(a.league_tier, a.region) === key(b.league_tier, b.region);
}
