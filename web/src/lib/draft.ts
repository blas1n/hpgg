/** 밴픽 simulator (#25). Pure: the order, Cho'gall, what is left, the suggestions and the share link.
 *
 *  Order: the Storm League draft as Heroes Profile's drafter and a recorded draft have it (issue #25) — A = the
 *  first-pick team: ban A, ban B, ban A, ban B · A · B B · A A · ban B, ban A · B B · A A · B.
 *
 *  Suggestion for the team to act (a ban: the other team's side — what they would most want):
 *    score = 0.7 × (WRs − 50) + 0.3 × Σ allies: gap(ally with h) + 0.1 × Σ enemies: −gap(enemy against h)
 *          + 0.2 × map gap(h) + comp(h)
 *  pair gap = the picked hero's rate with / against h − what h's own strength alone brings (lib/matchups.ts
 *  pairExpected), shrunk by n / (n + MATCHUP_K), pairs under MATCHUP_MIN_GAMES or within the error left out (the hero
 *  page's rule); pair gaps are read from the picked heroes' matchups files; comp(h) is what h costs the team's
 *  composition (lib/comps.ts: its measured costs and how often its make-up is chosen, against the best team still
 *  reachable — about 0 while the remaining picks can still fix it). Every term is shown next to the score,
 *  weighted, so the terms add up to it.
 *
 *  Weights (DRAFT_WEIGHTS, owner 2026-10-15): the share of each term's %p that showed in later games — a logistic fit
 *  of the result on the two teams' differences, Heroes Profile data as of 10-06/07 judged on 6,207 Storm League replays
 *  from 10-08 (the same games inside Heroes Profile's numbers inflated the pair terms several times over), with the
 *  pair gaps as above: base 0.72 ± 0.25, allies 0.28 ± 0.17, enemies 0.12 ± 0.08, map 0.23 ± 0.17, comp 0.93 ± 1.0
 *  (95 %). Re-measure as the sample grows. */
import type { HeroTable, MatchupsFile } from "../data";
import type { Locale } from "../i18n/locale";
import { messages } from "../i18n/messages";
import { FORMULA, shrinkWinRate, type Snapshot } from "../formula";
import { COMP_POP, MAKEUP_ROLES, TEAM_SIZE, compTerm, roleOf, type CompModel, type Member, type Role } from "./comps";
import { MATCHUP_K, MATCHUP_MIN_GAMES, beyondError, matchupScore, pairExpected } from "./matchups";

export type Side = "first" | "second";
export interface DraftStep {
  side: Side;
  kind: "ban" | "pick";
}

const step = (side: Side, kind: DraftStep["kind"]): DraftStep => ({ side, kind });
export const DRAFT_ORDER: readonly DraftStep[] = [
  step("first", "ban"), step("second", "ban"), step("first", "ban"), step("second", "ban"),
  step("first", "pick"),
  step("second", "pick"), step("second", "pick"),
  step("first", "pick"), step("first", "pick"),
  step("second", "ban"), step("first", "ban"),
  step("second", "pick"), step("second", "pick"),
  step("first", "pick"), step("first", "pick"),
  step("second", "pick"),
];

/** A hero as the simulator needs it: tier-table win-rate input and per-map records from the shown Storm League snapshot. */
export interface DraftHero {
  slug: string;
  name: string; // API name (matchups rows use it)
  ko: string;
  role: string;
  role_ko: string;
  portrait?: string;
  wrs: number; // the tier formula's shrunk (party-corrected) win rate, %
  wr: number; // raw win rate, %
  games: number;
  maps: Record<string, { wr: number; games: number }>;
}

/** Build time: every hero of the table, with its Storm League record from the shown snapshot (none: neutral 50 %). */
export function draftHeroes(snap: Snapshot | null, table: HeroTable): DraftHero[] {
  const all = new Map<string, Snapshot["rows"][number]>();
  const maps = new Map<string, Record<string, { wr: number; games: number }>>();
  for (const r of snap?.rows ?? []) {
    if (r.map === "all") all.set(r.hero, r);
    else if (r.games > 0) (maps.get(r.hero) ?? maps.set(r.hero, {}).get(r.hero)!)[r.map] = { wr: (r.wins / r.games) * 100, games: r.games };
  }
  return table.heroes.map((h) => {
    const r = all.get(h.name);
    return {
      slug: h.slug,
      name: h.name,
      ko: h.ko,
      role: h.role,
      role_ko: h.role_ko,
      ...(h.portrait ? { portrait: h.portrait } : {}),
      wrs: r ? shrinkWinRate(r.tier_win_rate ?? r.win_rate, r.games, FORMULA.k) : 50,
      wr: r ? r.win_rate : 50,
      games: r?.games ?? 0,
      maps: maps.get(h.name) ?? {},
    };
  });
}

/** Cho and Gall are one hero played by two players: picking a half fills the same team's next slot with the other. */
const PARTNER: Record<string, string> = { cho: "gall", gall: "cho" };

export interface TeamDraft {
  bans: string[];
  picks: string[];
}
export interface DraftState {
  step: number;
  next: DraftStep | null;
  first: TeamDraft;
  second: TeamDraft;
}

export function draftState(seq: readonly string[]): DraftState {
  const first: TeamDraft = { bans: [], picks: [] };
  const second: TeamDraft = { bans: [], picks: [] };
  seq.slice(0, DRAFT_ORDER.length).forEach((slug, i) => {
    const s = DRAFT_ORDER[i]!;
    (s.side === "first" ? first : second)[s.kind === "ban" ? "bans" : "picks"].push(slug);
  });
  const n = Math.min(seq.length, DRAFT_ORDER.length);
  return { step: n, next: DRAFT_ORDER[n] ?? null, first, second };
}

/** A Cho'gall half may be picked only where the same team picks again right after (else the other half has no slot). */
const pairFits = (i: number): boolean => {
  const s = DRAFT_ORDER[i];
  const t = DRAFT_ORDER[i + 1];
  return !!s && !!t && s.kind === "pick" && t.kind === "pick" && s.side === t.side;
};

const taken = (seq: readonly string[]): Set<string> => new Set(seq.flatMap((s) => (PARTNER[s] ? [s, PARTNER[s]!] : [s])));

/** Heroes that can be banned or picked at the current step. */
export function available<T extends { slug: string }>(heroes: readonly T[], seq: readonly string[]): T[] {
  const i = seq.length;
  const s = DRAFT_ORDER[i];
  if (!s) return [];
  const out = taken(seq);
  return heroes.filter((h) => !out.has(h.slug) && !(PARTNER[h.slug] && s.kind === "pick" && !pairFits(i)));
}

export function applyPick(seq: readonly string[], slug: string): string[] {
  const i = seq.length;
  const partner = PARTNER[slug];
  return partner && pairFits(i) ? [...seq, slug, partner] : [...seq, slug];
}

export function undo(seq: readonly string[]): string[] {
  const n = seq.length;
  const last = seq[n - 1];
  // a Cho'gall pair goes back together
  if (n >= 2 && last && PARTNER[last] === seq[n - 2] && DRAFT_ORDER[n - 1]?.kind === "pick" && pairFits(n - 2)) return seq.slice(0, n - 2);
  return seq.slice(0, Math.max(0, n - 1));
}

export const DRAFT_WEIGHTS = { base: 0.7, allies: 0.3, enemies: 0.1, map: 0.2, comp: 1 } as const;

/** The rule as printed under the simulator, with the weights the score uses (they drifted from the text once). */
export const draftRule = (locale: Locale): string =>
  messages[locale].draft.rule(String(MATCHUP_K), String(MATCHUP_MIN_GAMES), {
    base: String(DRAFT_WEIGHTS.base),
    allies: String(DRAFT_WEIGHTS.allies),
    enemies: String(DRAFT_WEIGHTS.enemies),
    map: String(DRAFT_WEIGHTS.map),
    pop: String(COMP_POP),
  });

export interface Suggestion {
  hero: DraftHero;
  score: number;
  terms: { base: number; allies: number; enemies: number; map: number; comp: number };
  /** Picked heroes (on either team) whose matchups file is not loaded: their pairs add nothing. */
  missing: string[];
}

export interface RecommendOptions {
  matchups: ReadonlyMap<string, MatchupsFile>;
  map: string | null;
  /** Team composition model (lib/comps.ts compModel); null or absent: the term is 0. */
  comps?: CompModel | null;
}

/** Suggestions for the current step, best first. */
export function recommend(heroes: readonly DraftHero[], seq: readonly string[], { matchups, map, comps }: RecommendOptions): Suggestion[] {
  const st = draftState(seq);
  if (!st.next) return [];
  // a pick scores for the team picking; a ban scores for the other team (what it would most want)
  const forSide: Side = st.next.kind === "pick" ? st.next.side : st.next.side === "first" ? "second" : "first";
  const known = new Set(heroes.map((h) => h.slug));
  const allies = st[forSide].picks.filter((s) => known.has(s));
  const enemies = st[forSide === "first" ? "second" : "first"].picks.filter((s) => known.has(s));
  const missing = [...allies, ...enemies].filter((s) => !matchups.has(s));
  // the picked hero's rate with or against h, against what h's own strength alone brings (pairExpected)
  const gap = (slug: string, side: "ally" | "enemy", h: DraftHero): number => {
    const f = matchups.get(slug);
    const row = f?.[side].find((p) => p.hero === h.name);
    if (!f || !row || row.games < MATCHUP_MIN_GAMES) return 0;
    const expected = pairExpected(f.win_rate, h.games > 0 ? h.wr : undefined, side);
    return beyondError(row.win_rate, expected, row.games) ? matchupScore(row.win_rate, expected, row.games) : 0;
  };
  const open = available(heroes, seq);
  const bySlug = new Map(heroes.map((h) => [h.slug, h]));
  // a hero that also plays a second role (the collector's played roles) can be either
  const memberOf = (x: DraftHero | undefined): Member => {
    const r = roleOf(x?.role ?? "");
    const second = x ? comps?.second[x.name] : undefined;
    return second && second !== r ? [r, second] : r;
  };
  const roleOfSlug = (s: string): Member => memberOf(bySlug.get(s));
  // the team's picks by role (an unknown slug still takes a slot), the slots it has left and what is left to pick
  const team = st[forSide].picks.map(roleOfSlug);
  const slots = TEAM_SIZE - team.length;
  const pool = Object.fromEntries(MAKEUP_ROLES.map((r) => [r, 0])) as Record<Role, number>;
  for (const h of open) pool[roleOf(h.role)] += 1;
  const compOf = (h: DraftHero): number => {
    if (!comps) return 0;
    const partner = PARTNER[h.slug];
    const cand = [memberOf(h), ...(partner && st.next!.kind === "pick" ? [roleOfSlug(partner)] : [])];
    return compTerm(team, cand, slots, pool, comps);
  };
  return open
    .map((h) => {
      const m = map ? h.maps[map] : undefined;
      const w = DRAFT_WEIGHTS;
      const terms = {
        base: w.base * (h.wrs - 50),
        allies: w.allies * allies.reduce((a, s) => a + gap(s, "ally", h), 0),
        // an enemy's win rate against h going down is h's advantage
        enemies: w.enemies * enemies.reduce((a, s) => a - gap(s, "enemy", h), 0),
        map: w.map * (m ? matchupScore(m.wr, h.wr, m.games) : 0),
        comp: w.comp * compOf(h),
      };
      return { hero: h, score: terms.base + terms.allies + terms.enemies + terms.map + terms.comp, terms, missing };
    })
    .sort((a, b) => b.score - a.score || a.hero.slug.localeCompare(b.hero.slug));
}

export interface DraftLink {
  usFirst: boolean;
  map: string | null;
  seq: string[];
}

export function encodeDraft({ usFirst, map, seq }: DraftLink): string {
  const q = new URLSearchParams();
  if (!usFirst) q.set("first", "them");
  if (map) q.set("map", map);
  if (seq.length) q.set("d", seq.join("."));
  return q.toString();
}

/** A shared link, replayed through the rules: it stops at the first slug that is no hero or not allowed there. */
export function decodeDraft(search: string, heroes: readonly DraftHero[]): DraftLink {
  const q = new URLSearchParams(search);
  let seq: string[] = [];
  for (const slug of (q.get("d") ?? "").split(".").filter(Boolean)) {
    if (seq.includes(slug)) continue; // the auto-filled Cho'gall half
    if (!available(heroes, seq).some((h) => h.slug === slug)) break;
    seq = applyPick(seq, slug);
  }
  return { usFirst: q.get("first") !== "them", map: q.get("map") || null, seq };
}
