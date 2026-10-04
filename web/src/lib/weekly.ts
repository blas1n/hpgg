/** 주간 메타 리포트 (owner 2026-10-05): one issue of data/weekly/<week>.json (collector/weekly.py) as the page shows
 *  it — the week's own games ranked by the site's tier formula, against the week before or, in a patch's first week,
 *  the previous patch. Numbers only; nothing is said about cause. Pure: computed at build time. */
import { computeTiers, type Row, type Snapshot, type Tier } from "../formula";
import type { HeroTable, Mode } from "../data";
import type { HeroRef } from "./home";

export interface WeeklyIssue {
  week: string;
  /** week = two Monday records of one patch; patch_start = the week a patch began, counted from its start */
  kind: "week" | "patch_start";
  start: string;
  end: string;
  patch: string;
  collected_at: string;
  baseline: { kind: "week"; week: string } | { kind: "previous_patch"; patch: string } | null;
  views: Partial<Record<Mode, { window: Snapshot; baseline: Snapshot | null }>>;
  /** each day of the week: hero → [games, wins] that day */
  daily: Partial<Record<Mode, { day: string; heroes: Record<string, [number, number]> }[]>>;
}

export interface WeeklyIndex {
  issues: { week: string; kind: WeeklyIssue["kind"]; start: string; end: string; patch: string }[];
}

export interface WeeklyRow {
  hero: HeroRef;
  tier: Tier;
  rank: number;
  prevRank: number | null;
  /** previous rank − rank (positive = climbed); null when unranked before */
  delta: number | null;
  wr: number;
  prevWr: number | null;
  pick: number;
  games: number;
}

export interface WeeklyModeModel {
  matches: number;
  top: WeeklyRow[];
  up: WeeklyRow[];
  down: WeeklyRow[];
  /** in this week and not in the baseline */
  fresh: WeeklyRow[];
  headline: { up: WeeklyRow | null; down: WeeklyRow | null; mostPlayed: WeeklyRow | null };
  daily: { days: string[]; series: { hero: HeroRef; wr: (number | null)[] }[] };
}

export interface WeeklyModel {
  week: string;
  kind: WeeklyIssue["kind"];
  monday: string;
  sunday: string;
  /** patch_start: the day the patch began */
  start: string;
  patch: string;
  baseline: WeeklyIssue["baseline"];
  collectedAt: string;
  modes: Partial<Record<Mode, WeeklyModeModel>>;
  older: string | null;
  newer: string | null;
}

export const TOP_N = 10;
export const MOVERS_N = 5;
/** a day's win rate under this many games is a gap in the line, not a number */
export const DAILY_MIN_GAMES = 20;

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Monday and Sunday of an ISO week ("2026-w40"). */
export function weekDays(week: string): { monday: string; sunday: string } {
  const [y, w] = week.split("-w").map(Number) as [number, number];
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86_400_000 + (w - 1) * 7 * 86_400_000);
  return { monday: iso(monday), sunday: iso(new Date(monday.getTime() + 6 * 86_400_000)) };
}

function refs(heroes: HeroTable): Map<string, HeroRef> {
  return new Map(heroes.heroes.map((h) => [h.name, { slug: h.slug, ko: h.ko, name: h.name, role: h.role, role_ko: h.role_ko, portrait: h.portrait }]));
}

function mode(view: { window: Snapshot; baseline: Snapshot | null }, daily: WeeklyIssue["daily"][Mode], heroes: Map<string, HeroRef>, minGames: number): WeeklyModeModel {
  const known = (rows: Row[]) => rows.filter((r) => r.map === "all" && heroes.has(r.hero));
  const ranked = computeTiers(known(view.window.rows), minGames).ranked;
  const base = view.baseline ? known(view.baseline.rows) : null;
  const prevRank = new Map(base ? computeTiers(base, minGames).ranked.map((x) => [x.row.hero, x.rank]) : []);
  const prevWr = new Map(base ? base.map((r) => [r.hero, r.win_rate]) : []);
  const rows: WeeklyRow[] = ranked.map((x) => {
    const p = prevRank.get(x.row.hero) ?? null;
    return { hero: heroes.get(x.row.hero)!, tier: x.tier, rank: x.rank, prevRank: p, delta: p === null ? null : p - x.rank, wr: x.row.win_rate, prevWr: prevWr.get(x.row.hero) ?? null, pick: x.row.pick, games: x.row.games };
  });
  const moved = rows.filter((r) => r.delta !== null && r.delta !== 0);
  const up = moved.filter((r) => r.delta! > 0).sort((a, b) => b.delta! - a.delta! || a.rank - b.rank).slice(0, MOVERS_N);
  const down = moved.filter((r) => r.delta! < 0).sort((a, b) => a.delta! - b.delta! || a.rank - b.rank).slice(0, MOVERS_N);
  const fresh = base ? rows.filter((r) => !prevWr.has(r.hero.name)) : [];
  const mostPlayed = [...rows].sort((a, b) => b.games - a.games)[0] ?? null;

  // the line follows the heroes the issue points at: the biggest moves and the new heroes
  const pointed = [...new Map([...up.slice(0, 3), ...down.slice(0, 3), ...fresh].map((r) => [r.hero.name, r.hero])).values()];
  const days = (daily ?? []).map((d) => d.day);
  const series = pointed.map((hero) => ({
    hero,
    wr: (daily ?? []).map((d) => {
      const v = d.heroes[hero.name];
      return v && v[0] >= DAILY_MIN_GAMES ? (v[1] / v[0]) * 100 : null;
    }),
  }));
  return { matches: view.window.matches, top: rows.slice(0, TOP_N), up, down, fresh, headline: { up: up[0] ?? null, down: down[0] ?? null, mostPlayed }, daily: { days, series } };
}

/** `weeks`: every issue, newest first (index.json), for the links to the issues before and after. */
export function weeklyModel(issue: WeeklyIssue, heroes: HeroTable, minGames: number, weeks: string[]): WeeklyModel {
  const index = refs(heroes);
  const modes: WeeklyModel["modes"] = {};
  for (const m of ["qm", "sl"] as const) {
    const view = issue.views[m];
    if (view) modes[m] = mode(view, issue.daily[m], index, minGames);
  }
  const at = weeks.indexOf(issue.week);
  const { monday, sunday } = weekDays(issue.week);
  return {
    week: issue.week,
    kind: issue.kind,
    monday,
    sunday,
    start: issue.start,
    patch: issue.patch,
    baseline: issue.baseline,
    collectedAt: issue.collected_at,
    modes,
    newer: at > 0 ? weeks[at - 1]! : null,
    older: at >= 0 && at < weeks.length - 1 ? weeks[at + 1]! : null,
  };
}
