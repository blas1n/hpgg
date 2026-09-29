/** Which snapshot a page shows. One reference patch for every page (meta.reference_patch, decided by the collector);
 *  a view with no valid file on it shows nothing rather than another patch — and a bracket file is only shown under a
 *  bracket label when it covers exactly those league tiers. */
import type { Snapshot } from "../formula";
import { BRACKET_TIERS, REGION_CODE, referencePatch, snapshotKey, type Bracket, type HeroTable, type Meta, type Mode, type Region } from "../data";
import { knownOnly } from "./known";

export function bracketMatches(snap: Snapshot, bracket: Bracket): boolean {
  const want = BRACKET_TIERS[bracket];
  const have = snap.league_tier;
  if (!want || !have) return want === null && have === null;
  return [...have].sort((a, b) => a - b).join(",") === want.join(",");
}

export interface Shown {
  snap: Snapshot;
  /** Same file on the previous patch, for ▲▼ — only when `snap` is the current patch. */
  previous: Snapshot | null;
  /** true = the reference patch is the previous one (the current is too thin), `snap` is on it. */
  fallback: boolean;
}

type Read = (key: string, patch: "current" | "previous") => Snapshot | null;

/** A region file is only shown under its own region; files without `region` (before #14) are every region. */
export function regionMatches(snap: Snapshot, region: Region): boolean {
  return (snap.region ?? null) === REGION_CODE[region];
}

/** `heroes`: rows of heroes without assets are dropped from both files (lib/known.ts). */
export function pickShown(meta: Meta, mode: Mode, bracket: Bracket, read: Read, heroes: HeroTable, region: Region = "all"): Shown | null {
  const key = snapshotKey(mode, bracket, region);
  const valid = (s: Snapshot | null) => (s && bracketMatches(s, bracket) && regionMatches(s, region) ? knownOnly(s, heroes) : null);
  if (referencePatch(meta) === "previous") {
    const prev = valid(read(key, "previous"));
    return prev ? { snap: prev, previous: null, fallback: true } : null;
  }
  const cur = valid(read(key, "current"));
  const prev = meta.previous_patch ? valid(read(key, "previous")) : null;
  return cur ? { snap: cur, previous: prev, fallback: false } : null;
}
