/** 팀 조합 for the 밴픽 suggestions (roadmap stage 3, owner 2026-10-15: later picks weigh the team more). Pure.
 *
 *  collector/team_comps.py counts each Storm League team of the patch's window by how many healers, front-liners
 *  (tank + bruiser) and ranged assassins it drafted, and by its exact make-up (data/latest/sl_comps.json).
 *  - A count costs its gap from 50 % only when it loses beyond the error (two-sided 95 %, COMP_MIN_GAMES teams or
 *    more); a count that wins more is not chased (a team of no ranged assassin won 56 % on 212 teams — a best-of over
 *    thin cells would chase chance).
 *  - How often players choose a make-up adds COMP_POP × ln(its share of teams) (owner 2026-10-15: people do it for a
 *    reason, as the tier formula weighs pick rate). Measured out of sample (10,800 games, two halves, each judged on
 *    the other's counts): a rarer make-up loses more even with its own win rate accounted for, about −1 %p for one
 *    chosen 10 times less often (z ≈ 2.1). A file without make-up counts adds nothing.
 *
 *  comp term of a candidate = best team still reachable with it − best team still reachable without deciding: about
 *  0 while the remaining slots can still fix the team, the full cost once they cannot — so it grows as the draft
 *  goes on. */
import { MATCHUP_Z } from "./matchups";

export type CompGroup = "healer" | "front" | "ranged";
export type PoolGroup = CompGroup | "other";
/** collector/team_comps.py MAKEUP_ROLES: the order of a make-up key. */
export const MAKEUP_ROLES = ["Tank", "Bruiser", "Healer", "Ranged Assassin", "Melee Assassin", "Support"] as const;
export type Role = (typeof MAKEUP_ROLES)[number];
/** %p per unit of ln(share of teams): −1 %p for a make-up chosen 10 times less often. */
export const COMP_POP = 0.43;
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
  /** Teams by exact make-up (makeupKey); absent in files from before 2026-10-16. */
  makeups?: Record<string, Count>;
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

/** A hero of no listed role counts as a melee assassin (the rest). */
export const roleOf = (role: string): Role => ((MAKEUP_ROLES as readonly string[]).includes(role) ? (role as Role) : "Melee Assassin");

export const makeupKey = (roles: readonly Role[]): string => MAKEUP_ROLES.map((r) => roles.filter((x) => x === r).length).join("-");

/** What the suggestions read: the measured costs and each make-up's ln share (null: no make-up counts). */
export interface CompModel {
  penalties: CompPenalties;
  logShare: Record<string, number> | null;
  /** ln share of a make-up nobody chose: counted as one team. */
  unseen: number;
}

export function compModel(file: CompsFile): CompModel {
  const ln = (n: number) => Math.log((n + 1) / (file.teams + 1));
  const logShare = file.makeups ? Object.fromEntries(Object.entries(file.makeups).map(([k, c]) => [k, ln(c.games)])) : null;
  return { penalties: compPenalties(file), logShare, unseen: ln(0) };
}

/** A finished team's value: its measured costs plus how often its make-up is chosen. */
function value(counts: readonly number[], m: CompModel): number {
  const [tank, bruiser, healer, ranged] = counts as [number, number, number, number];
  const g = { healer, front: tank + bruiser, ranged };
  const costs = COMP_GROUPS.reduce((a, k) => a + m.penalties[k][Math.min(g[k], COMP_CAPS[k])]!, 0);
  return costs + (m.logShare ? COMP_POP * (m.logShare[counts.join("-")] ?? m.unseen) : 0);
}

/** The best value a team can still end with: `slots` more heroes from `pool` (heroes left, by role). */
export function bestReachable(team: readonly Role[], slots: number, pool: Readonly<Record<Role, number>>, m: CompModel): number {
  const counts = MAKEUP_ROLES.map((r) => team.filter((x) => x === r).length);
  let best = -Infinity;
  const fill = (i: number, left: number) => {
    if (i === MAKEUP_ROLES.length) {
      if (left === 0) best = Math.max(best, value(counts, m));
      return;
    }
    for (let n = 0; n <= Math.min(left, pool[MAKEUP_ROLES[i]!]); n++) {
      counts[i]! += n;
      fill(i + 1, left - n);
      counts[i]! -= n;
    }
  };
  fill(0, slots);
  // a pool too small to fill the slots: judge the team as it is
  return best === -Infinity ? value(counts, m) : best;
}

/** What picking `cand` (one hero, or Cho'gall's two halves) costs a team with `slots` free; `pool` includes cand. */
export function compTerm(team: readonly Role[], cand: readonly Role[], slots: number, pool: Readonly<Record<Role, number>>, m: CompModel): number {
  const rest = { ...pool };
  for (const r of cand) rest[r] = Math.max(0, rest[r] - 1);
  const after = bestReachable([...team, ...cand], Math.max(0, slots - cand.length), rest, m);
  return Math.min(0, after - bestReachable(team, slots, pool, m));
}
