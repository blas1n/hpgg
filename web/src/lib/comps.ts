/** 팀 조합 for the 밴픽 suggestions (roadmap stage 3, owner 2026-10-15: later picks weigh the team more). Pure.
 *
 *  collector/team_comps.py counts each Storm League team of the patch's window by how many healers, front-liners
 *  (tank + bruiser) and ranged assassins it drafted (data/latest/sl_comps.json). A count costs its gap from 50 % only
 *  when it loses beyond the error (two-sided 95 %, COMP_MIN_GAMES teams or more); a count that wins more is not chased
 *  (a team of no ranged assassin won 56 % on 212 teams — a best-of over thin cells would chase chance).
 *
 *  comp term of a candidate = best team still reachable with it − best team still reachable without deciding: 0 while
 *  the remaining slots can still fix the team, the full cost once they cannot — so it grows as the draft goes on. */
import { MATCHUP_Z } from "./matchups";

export type CompGroup = "healer" | "front" | "ranged";
export type PoolGroup = CompGroup | "other";
export const COMP_GROUPS: readonly CompGroup[] = ["healer", "front", "ranged"];
/** The top count of each group holds every count above it (collector/team_comps.py CAPS). */
export const COMP_CAPS: Record<CompGroup, number> = { healer: 2, front: 3, ranged: 3 };
export const COMP_MIN_GAMES = 30;
export const TEAM_SIZE = 5;

interface Count {
  games: number;
  wins: number;
}
export interface CompsFile {
  patch: string;
  since: string | null;
  collected_at: string;
  games: number;
  teams: number;
  groups: Record<CompGroup, Record<string, Count>>;
}
/** Cost (%p, ≤ 0) of having n of a group, index n up to the cap. */
export type CompPenalties = Record<CompGroup, number[]>;

export function compPenalties(file: CompsFile): CompPenalties {
  const out = {} as CompPenalties;
  for (const g of COMP_GROUPS) {
    out[g] = Array.from({ length: COMP_CAPS[g] + 1 }, (_, n) => {
      const c = file.groups[g]?.[String(n)];
      if (!c || c.games < COMP_MIN_GAMES) return 0;
      const gap = (c.wins / c.games) * 100 - 50;
      const se = Math.sqrt(0.25 / c.games) * 100;
      return gap < 0 && -gap / se >= MATCHUP_Z ? gap : 0;
    });
  }
  return out;
}

export function groupOf(role: string): PoolGroup {
  if (role === "Healer") return "healer";
  if (role === "Tank" || role === "Bruiser") return "front";
  if (role === "Ranged Assassin") return "ranged";
  return "other";
}

const cost = (counts: Record<CompGroup, number>, p: CompPenalties): number =>
  COMP_GROUPS.reduce((a, g) => a + p[g][Math.min(counts[g], COMP_CAPS[g])]!, 0);

/** The least cost a team can still end with: `slots` more heroes from `pool` (heroes left, by group). */
export function bestReachable(team: readonly PoolGroup[], slots: number, pool: Record<PoolGroup, number>, p: CompPenalties): number {
  const base = { healer: 0, front: 0, ranged: 0 };
  for (const g of team) if (g !== "other") base[g] += 1;
  let best = -Infinity;
  for (let h = 0; h <= Math.min(slots, pool.healer); h++)
    for (let f = 0; f <= Math.min(slots - h, pool.front); f++)
      for (let r = 0; r <= Math.min(slots - h - f, pool.ranged); r++) {
        if (slots - h - f - r > pool.other) continue;
        best = Math.max(best, cost({ healer: base.healer + h, front: base.front + f, ranged: base.ranged + r }, p));
      }
  // a pool too small to fill the slots: judge the team as it is
  return best === -Infinity ? cost(base, p) : best;
}

/** What picking `cand` (one hero, or Cho'gall's two halves) costs a team with `slots` free; `pool` includes cand. */
export function compTerm(
  team: readonly PoolGroup[],
  cand: readonly PoolGroup[],
  slots: number,
  pool: Record<PoolGroup, number>,
  p: CompPenalties,
): number {
  const rest = { ...pool };
  for (const g of cand) rest[g] = Math.max(0, rest[g] - 1);
  const after = bestReachable([...team, ...cand], Math.max(0, slots - cand.length), rest, p);
  return Math.min(0, after - bestReachable(team, slots, pool, p));
}
