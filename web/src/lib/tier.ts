/** Tier table view model. Pure: the default view is computed at build time, other views in the browser. */
import { appliedParty, computeTiers, type Party, type Snapshot, type Tier } from "../formula";
import { wilson } from "../wilson";
import { sameCohort } from "./cohort";
import { referencePatch, REGIONS, type Bracket, type HeroTable, type Meta, type Mode, type PatchChoice, type Region } from "../data";
import type { HeroRef } from "./home";

export type SortKey = "score" | "win_rate" | "pick" | "ban_rate" | "games";
const SORT_KEYS: SortKey[] = ["score", "win_rate", "pick", "ban_rate", "games"];

export interface TierState {
  mode: Mode;
  bracket: Bracket; // Storm League only; "all" whenever a region is set (region × bracket is not collected)
  region: Region; // both modes
  map: string; // "all" or a map name; Storm League only
  role: string; // "all" or a role name
  /** "auto" = current patch, or the previous one while the current sample is thin. */
  patch: PatchChoice | "auto";
  sort: SortKey;
  dir: "desc" | "asc";
}

export const DEFAULT_TIER_STATE: TierState = { mode: "qm", bracket: "all", region: "all", map: "all", role: "all", patch: "auto", sort: "score", dir: "desc" };

export function parseTierState(search: string): TierState {
  const q = new URLSearchParams(search);
  const mode: Mode = q.get("mode") === "sl" ? "sl" : "qm";
  const bracket = q.get("tier");
  const sort = q.get("sort") as SortKey | null;
  const patch = q.get("patch");
  const r = q.get("region") as Region | null;
  const region: Region = r && r !== "all" && REGIONS.includes(r) ? r : "all";
  return {
    mode,
    // region × bracket is not collected: a region in the URL wins
    bracket: mode === "sl" && region === "all" && (bracket === "low" || bracket === "high") ? bracket : "all",
    region,
    map: mode === "sl" ? (q.get("map") ?? "all") : "all",
    role: q.get("role") ?? "all",
    patch: patch === "previous" || patch === "current" ? patch : "auto",
    sort: sort && SORT_KEYS.includes(sort) ? sort : "score",
    dir: q.get("dir") === "asc" ? "asc" : "desc",
  };
}

export function tierSearch(s: TierState): string {
  const q = new URLSearchParams();
  if (s.mode !== "qm") q.set("mode", s.mode);
  if (s.region !== "all") q.set("region", s.region);
  if (s.mode === "sl" && s.bracket !== "all") q.set("tier", s.bracket);
  if (s.mode === "sl" && s.map !== "all") q.set("map", s.map);
  if (s.role !== "all") q.set("role", s.role);
  if (s.patch !== "auto") q.set("patch", s.patch);
  if (s.sort !== "score") q.set("sort", s.sort);
  if (s.dir !== "desc") q.set("dir", s.dir);
  return q.toString();
}

/** Which patch a view shows: "auto" is the site's one reference patch (meta.reference_patch); a patch chosen in the
 *  URL ("현재 패치 보기") wins. */
export function resolvePatch(meta: Meta, choice: TierState["patch"]): { patch: PatchChoice; auto: boolean } {
  if (!meta.previous_patch) return { patch: "current", auto: false };
  if (choice === "auto") {
    const patch = referencePatch(meta);
    return { patch, auto: patch === "previous" };
  }
  return { patch: choice, auto: false };
}

export interface TierRow {
  hero: HeroRef;
  tier: Tier;
  rank: number;
  /** Rank on the previous patch; null when the table has no previous patch or the hero was unranked there. */
  prevRank: number | null;
  score: number;
  win_rate: number;
  /** Wilson 95% interval half-width, %p. */
  wrHalf: number;
  pick: number;
  ban_rate: number;
  games: number;
}

export interface TierTable {
  rows: TierRow[]; // score order
  grey: { hero: HeroRef; games: number }[]; // below the sample floor: no tier
  matches: number;
  hasPrevious: boolean;
  patch: string;
  collectedAt: string;
  party: Party | null; // printed in the formula when this view's win rates are party-corrected
}

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function heroRef(heroes: HeroTable): (name: string) => HeroRef {
  const by = new Map(heroes.heroes.map((h) => [h.name, h]));
  return (name) => {
    const h = by.get(name);
    return h
      ? { slug: h.slug, ko: h.ko, name: h.name, role: h.role, role_ko: h.role_ko, portrait: h.portrait }
      : { slug: slugOf(name), ko: name, name, role: "", role_ko: "" };
  };
}

/** One snapshot + map → ranked rows. `previous` is the same file on the previous patch; a different bracket cohort is ignored. */
export function tierTable(snap: Snapshot, previous: Snapshot | null, map: string, heroes: HeroTable, minGames: number): TierTable {
  const ref = heroRef(heroes);
  const rows = snap.rows.filter((r) => r.map === map);
  const { ranked, grey } = computeTiers(rows, minGames);
  const prev = previous && sameCohort(previous, snap) ? previous : null;
  const prevRank = new Map(prev ? computeTiers(prev.rows.filter((r) => r.map === map), minGames).ranked.map((x) => [x.row.hero, x.rank]) : []);
  return {
    rows: ranked.map((x) => {
      const [lo, hi] = wilson(x.row.wins, x.row.games);
      return {
        hero: ref(x.row.hero),
        tier: x.tier,
        rank: x.rank,
        prevRank: prevRank.get(x.row.hero) ?? null,
        score: x.score,
        win_rate: x.row.win_rate,
        wrHalf: (hi - lo) / 2,
        pick: x.row.pick,
        ban_rate: x.row.ban_rate,
        games: x.row.games,
      };
    }),
    grey: grey.map((r) => ({ hero: ref(r.hero), games: r.games })),
    // every match has ten hero slots
    matches: map === "all" ? snap.matches : Math.round(rows.reduce((a, r) => a + r.games, 0) / 10),
    hasPrevious: prev !== null,
    patch: snap.patch,
    collectedAt: snap.collected_at,
    party: appliedParty(snap, rows),
  };
}

/** Role filter + display order. Tiers and ranks stay those of the whole table. */
/** A header click: a new column sorts descending and the same one again flips it. "rank" (the rank and tier
 *  headers) always goes back to the ranked order, #1 first, so a re-sorted table has an obvious way home. */
export function nextSort(cur: Pick<TierState, "sort" | "dir">, key: SortKey | "rank"): Pick<TierState, "sort" | "dir"> {
  if (key === "rank") return { sort: "score", dir: "desc" };
  return cur.sort === key ? { sort: key, dir: cur.dir === "desc" ? "asc" : "desc" } : { sort: key, dir: "desc" };
}

export function visibleRows(rows: TierRow[], role: string, sort: SortKey, dir: "desc" | "asc"): TierRow[] {
  const val = (r: TierRow) => (sort === "score" ? r.score : r[sort]);
  return rows.filter((r) => role === "all" || r.hero.role === role).sort((a, b) => (dir === "desc" ? val(b) - val(a) : val(a) - val(b)) || a.rank - b.rank);
}

/** Score as printed: whole points with a sign. */
export function formatScore(score: number): string {
  return (score >= 0 ? "+" : "") + score.toFixed(0);
}
