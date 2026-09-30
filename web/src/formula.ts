/** Tier formula. Every number here is printed on the page; nothing is hidden. */
import type { Locale } from "./i18n/locale";
import { messages } from "./i18n/messages";

export interface Row {
  hero: string;
  map: string;
  wins: number;
  losses: number;
  games: number;
  bans: number;
  pick: number; // %p 0–100
  popularity: number;
  win_rate: number; // %p 0–100
  ban_rate: number; // %p 0–100
  ci: number | null;
  /** Party-corrected win rate (#36), set by the collector on the QM / SL `map="all"` rows: the formula's win-rate input. */
  tier_win_rate?: number;
}

/** How the collector corrected the win rate for premade groups (collector/party.py). */
export interface Party {
  k: number;
  solo_pooled: number; // %p, pooled win rate of solo-queue games
  solo_games: number;
}

export interface Snapshot {
  patch: string;
  mode: string;
  game_type: string;
  league_tier: number[] | null;
  /** HP region code (KR, NA, EU) of a region file; null or absent = every region. */
  region?: string | null;
  collected_at: string;
  matches: number;
  rows: Row[];
  party?: Party | null;
}

export const TIERS = ["S", "A", "B", "C", "D", "F"] as const;
export type Tier = (typeof TIERS)[number];

/** Cumulative share of the ranked (n ≥ minGames) heroes per tier: S 6% / A 24% / B 54% / C 82% / D 94% / F rest. */
export const CUTS = [0.06, 0.24, 0.54, 0.82, 0.94, 1.01] as const;

/** The one formula: pick × (WRs − 50) × 3 + ban × 1, win rate shrunk with k = 500. Low-WR popular heroes sink. */
export const FORMULA = { wPick: 3, wBan: 1, k: 500 } as const;

/** WRs = 50 + (WR − 50) × n / (n + k). Pulls small samples toward 50. */
export function shrinkWinRate(winRate: number, games: number, k: number): number {
  if (games <= 0) return 50;
  return 50 + ((winRate - 50) * games) / (games + k);
}

export function scoreRow(r: Row): number {
  const wrs = shrinkWinRate(r.tier_win_rate ?? r.win_rate, r.games, FORMULA.k);
  return r.pick * (wrs - 50) * FORMULA.wPick + r.ban_rate * FORMULA.wBan;
}

export interface Ranked {
  row: Row;
  score: number;
  tier: Tier;
  rank: number; // 1-based among ranked rows
}

export interface TierResult {
  ranked: Ranked[];
  grey: Row[]; // games < minGames: shown, never tiered, not in the denominator
}

/** boundary_i = min(N, max(floor(share_i × N), boundary_{i−1} + 1)) — monotonic, ≥1 per tier while heroes last. */
export function boundaries(n: number): number[] {
  const out: number[] = [];
  let prev = 0;
  for (const c of CUTS) {
    const b = Math.min(n, Math.max(Math.floor(c * n), prev + 1));
    out.push(b);
    prev = b;
  }
  return out;
}

export function computeTiers(rows: Row[], minGames: number): TierResult {
  const grey = rows.filter((r) => r.games < minGames);
  const scored = rows
    .filter((r) => r.games >= minGames)
    .map((row) => ({ row, score: scoreRow(row) }))
    .sort((a, b) => b.score - a.score || a.row.hero.localeCompare(b.row.hero));
  const bounds = boundaries(scored.length);
  const ranked: Ranked[] = scored.map((s, i) => {
    let tier: Tier = "F";
    for (let t = 0; t < bounds.length; t++) {
      if (i < (bounds[t] ?? 0)) {
        tier = TIERS[t] ?? "F";
        break;
      }
    }
    return { row: s.row, score: s.score, tier, rank: i + 1 };
  });
  return { ranked, grey };
}

/** The snapshot's party correction when the rows being ranked carry it (per-map rows never do). */
export function appliedParty(snap: Snapshot | null, rows: Row[]): Party | null {
  return snap?.party && rows.some((r) => r.tier_win_rate !== undefined) ? snap.party : null;
}

/** The one-line explanation printed under the table. */
export function formulaLine(hasBans: boolean, locale: Locale): string {
  const f = messages[locale].formula;
  return f.line(String(FORMULA.wPick), hasBans ? f.ban(String(FORMULA.wBan)) : "");
}

/** The worked formula under "자세히" (Details). */
export function formulaDetail(hasBans: boolean, minGames: number, locale: Locale, party: Party | null = null): string {
  const f = messages[locale].formula;
  const ban = hasBans ? f.ban(String(FORMULA.wBan)) : f.noBan;
  const detail = f.detail(String(FORMULA.k), f.detailScore(String(FORMULA.wPick), ban), String(minGames));
  if (!party) return detail;
  const shift = (50 - party.solo_pooled).toFixed(2);
  return f.party(shift, String(party.k), party.solo_pooled.toFixed(2)) + "\n" + detail.replace(f.wrInput, f.wrInputCorrected);
}
