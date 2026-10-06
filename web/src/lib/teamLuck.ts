/** 팀운 (#90, owner 2026-10-06): GET /v1/players/teamluck?mode=all|qm|sl (server/players/teamluck.py) — per game, the
 *  mean MMR of the player's 4 teammates minus the 5 opponents' before the game, over the newest games of a mode. Pure
 *  but for the fetch. */
import type { CarryPlayer } from "./carry";
import { apiGet, type ApiResult, type FetchOptions, type Region } from "./players";

export type TeamLuckMode = "all" | "qm" | "sl";

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
  /** the game's length and the player's team, for 몇인분 (lib/carry.ts) */
  length_s: number | null;
  team: CarryPlayer[];
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

export type LuckGrade = "best" | "good" | "normal" | "bad" | "worst";

/** 팀운 in five words (owner 2026-10-06: a light line, no MMR numbers): the newest games' mean of teammates − opponents
 *  MMR before each game. ±30 is noise over 20 games; ±80 is a team well above or below yours most games. */
export function luckGrade(gapAvg: number | null): LuckGrade | null {
  if (gapAvg === null) return null;
  if (gapAvg >= 80) return "best";
  if (gapAvg >= 30) return "good";
  if (gapAvg <= -80) return "worst";
  if (gapAvg <= -30) return "bad";
  return "normal";
}

export type CarryTone = "carry" | "share" | "light";

/** 몇인분 (owner 2026-10-06: "졌을 때도 1.5인분 했다면서 웃을 수 있잖아"): 1.3 or more stands out (the top ~8 % of
 *  Storm League player-games), 0.7 or less was a light game. */
export function carryTone(carry: number | null): CarryTone | null {
  if (carry === null) return null;
  if (carry >= 1.3) return "carry";
  if (carry <= 0.7) return "light";
  return "share";
}
