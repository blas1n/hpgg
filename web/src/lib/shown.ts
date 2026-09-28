/** Which snapshot a page shows. One rule for every page: the current patch, or the previous one while the current
 *  sample is thin — and a bracket file is only shown under a bracket label when it covers exactly those league tiers. */
import type { Snapshot } from "../formula";
import { BRACKET_TIERS, snapshotKey, type Bracket, type Meta, type Mode } from "../data";
import { resolvePatch } from "./tier";

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
  /** true = the current patch is too thin, `snap` is the previous patch. */
  fallback: boolean;
}

type Read = (key: string, patch: "current" | "previous") => Snapshot | null;

export function pickShown(meta: Meta, mode: Mode, bracket: Bracket, read: Read): Shown | null {
  const key = snapshotKey(mode, bracket);
  const valid = (s: Snapshot | null) => (s && bracketMatches(s, bracket) ? s : null);
  const cur = valid(read(key, "current"));
  const prev = meta.previous_patch ? valid(read(key, "previous")) : null;
  if (resolvePatch(meta, mode, "auto").patch === "previous" && prev) return { snap: prev, previous: null, fallback: true };
  return cur ? { snap: cur, previous: prev, fallback: false } : null;
}
