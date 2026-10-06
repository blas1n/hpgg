/** 팀운 (#90, owner 2026-10-06): GET /v1/players/teamluck?mode=all|qm|sl (server/players/teamluck.py) — per game, the
 *  mean MMR of the player's 4 teammates minus the 5 opponents' before the game, over the newest games of a mode. Pure
 *  but for the fetch. */
import type { HeroTable } from "../data";
import type { Locale } from "../i18n/locale";
import { apiGet, type ApiResult, type FetchOptions, type Region } from "./players";

export type TeamLuckMode = "all" | "qm" | "sl";
export const TEAM_LUCK_MODES: TeamLuckMode[] = ["all", "sl", "qm"];
/** a gap this large either way is luck (the server's GOOD) */
export const LUCK = 50;

// --- API shape ---
export interface TeamLuckGame {
  replay_id: number;
  date: string | null;
  mode: string | null;
  hero: string | null;
  win: boolean;
  team_mmr: number;
  opp_mmr: number;
  gap: number;
}
interface Cell {
  games: number;
  wins: number;
}
export interface TeamLuckResponse {
  mode: TeamLuckMode;
  games: TeamLuckGame[];
  summary: { games: number; gap_avg: number | null; good: Cell; bad: Cell; even: Cell };
  partial: boolean;
  formula: { gap: string; good: number };
}

const isTeamLuck = (b: unknown): b is TeamLuckResponse =>
  typeof b === "object" && b !== null && Array.isArray((b as TeamLuckResponse).games) && typeof (b as TeamLuckResponse).summary === "object";

export const fetchTeamLuck = (battletag: string, region: Region, mode: TeamLuckMode, opts: FetchOptions = {}): Promise<ApiResult<TeamLuckResponse>> =>
  // up to 20 games not cached, one Heroes Profile call each
  apiGet("/v1/players/teamluck", { battletag, region, mode, games: "20" }, isTeamLuck, { timeoutMs: 60_000, ...opts });

export interface TeamLuckRow {
  id: number;
  date: string | null;
  hero: string;
  win: boolean;
  gap: number;
  /** −1…1: the gap against the largest in the list, for the bar */
  bar: number;
}
export interface TeamLuckView {
  games: number;
  gapAvg: number;
  verdict: "good" | "bad" | "even";
  good: { games: number; winRate: number | null };
  even: { games: number; winRate: number | null };
  bad: { games: number; winRate: number | null };
  rows: TeamLuckRow[];
  partial: boolean;
}

const rate = (c: Cell) => ({ games: c.games, winRate: c.games ? (c.wins / c.games) * 100 : null });

/** The card's numbers; null when no game could be counted. Heroes in the page language. */
export function teamLuckView(r: TeamLuckResponse, heroes: HeroTable, locale: Locale): TeamLuckView | null {
  const s = r.summary;
  if (!s.games || s.gap_avg === null) return null;
  const byName = new Map(heroes.heroes.map((h) => [h.name, h]));
  const name = (hero: string | null) => {
    const h = hero ? byName.get(hero) : undefined;
    return h ? (locale === "ko" ? h.ko : (h.en ?? h.name)) : (hero ?? "?");
  };
  const top = Math.max(...r.games.map((g) => Math.abs(g.gap)), 1);
  return {
    games: s.games,
    gapAvg: s.gap_avg,
    verdict: s.gap_avg >= LUCK ? "good" : s.gap_avg <= -LUCK ? "bad" : "even",
    good: rate(s.good),
    even: rate(s.even),
    bad: rate(s.bad),
    rows: r.games.map((g) => ({ id: g.replay_id, date: g.date, hero: name(g.hero), win: g.win, gap: g.gap, bar: g.gap / top })),
    partial: r.partial,
  };
}
