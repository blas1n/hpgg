/** 밴픽 simulator (#25). Pure: the order, Cho'gall, what is left, the suggestions and the share link.
 *
 *  Order: the Storm League draft as Heroes Profile's drafter and a recorded draft have it (issue #25) — A = the
 *  first-pick team: ban A, ban B, ban A, ban B · A · B B · A A · ban B, ban A · B B · A A · B.
 *
 *  Suggestion for the team to act (a ban: the other team's side — what they would most want):
 *    score = (WRs − 50) + Σ allies: gap(ally with h) + Σ enemies: −gap(enemy against h) + map gap(h)
 *  gaps shrunk by n / (n + MATCHUP_K) and pairs under MATCHUP_MIN_GAMES left out (the hero page's rule, lib/matchups.ts);
 *  pair gaps are read from the picked heroes' matchups files. Every term is shown next to the score. */
import type { HeroTable, MatchupsFile } from "../data";
import { FORMULA, shrinkWinRate, type Snapshot } from "../formula";
import { MATCHUP_MIN_GAMES, matchupScore } from "./matchups";

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

export interface Suggestion {
  hero: DraftHero;
  score: number;
  terms: { base: number; allies: number; enemies: number; map: number };
  /** Picked heroes (on either team) whose matchups file is not loaded: their pairs add nothing. */
  missing: string[];
}

export interface RecommendOptions {
  matchups: ReadonlyMap<string, MatchupsFile>;
  map: string | null;
}

/** Suggestions for the current step, best first. */
export function recommend(heroes: readonly DraftHero[], seq: readonly string[], { matchups, map }: RecommendOptions): Suggestion[] {
  const st = draftState(seq);
  if (!st.next) return [];
  // a pick scores for the team picking; a ban scores for the other team (what it would most want)
  const forSide: Side = st.next.kind === "pick" ? st.next.side : st.next.side === "first" ? "second" : "first";
  const known = new Set(heroes.map((h) => h.slug));
  const allies = st[forSide].picks.filter((s) => known.has(s));
  const enemies = st[forSide === "first" ? "second" : "first"].picks.filter((s) => known.has(s));
  const missing = [...allies, ...enemies].filter((s) => !matchups.has(s));
  const gap = (slug: string, side: "ally" | "enemy", name: string): number => {
    const f = matchups.get(slug);
    const row = f?.[side].find((p) => p.hero === name);
    return f && row && row.games >= MATCHUP_MIN_GAMES ? matchupScore(row.win_rate, f.win_rate, row.games) : 0;
  };
  return available(heroes, seq)
    .map((h) => {
      const m = map ? h.maps[map] : undefined;
      const terms = {
        base: h.wrs - 50,
        allies: allies.reduce((a, s) => a + gap(s, "ally", h.name), 0),
        // an enemy's win rate against h going down is h's advantage
        enemies: enemies.reduce((a, s) => a - gap(s, "enemy", h.name), 0),
        map: m ? matchupScore(m.wr, h.wr, m.games) : 0,
      };
      return { hero: h, score: terms.base + terms.allies + terms.enemies + terms.map, terms, missing };
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
