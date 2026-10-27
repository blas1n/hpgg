/** Hero detail view models. Pure: computed at build time for both modes and serialised into each hero page. */
import { buildBase, buildScore, computeTiers, type Snapshot, type Tier } from "../formula";
import { REGIONS, type Bracket, type Build, type BuildBracketKey, type BuildsFile, type BuildTalent, type MapTable, type Region, type TalentTable } from "../data";
import { DEFAULT_LOCALE, type Locale } from "../i18n/locale";
import { localField } from "../i18n/names";
import { messages } from "../i18n/messages";

export type HeroSummary =
  | {
      kind: "ranked";
      tier: Tier;
      rank: number;
      /** previous rank − rank; null when there is no previous patch or the hero was unranked there. */
      delta: number | null;
      prevRank: number | null;
      hasPrevious: boolean;
      win_rate: number;
      games: number;
      pick: number;
      ban_rate: number;
    }
  // below the sample floor; win_rate null = the hero has no game in a view that was collected
  | { kind: "grey"; win_rate: number | null; games: number; pick: number }
  | { kind: "none" };

const place = (snap: Snapshot, map: string, hero: string, minGames: number) => {
  const t = computeTiers(snap.rows.filter((r) => r.map === map), minGames);
  return { r: t.ranked.find((x) => x.row.hero === hero), grey: t.grey.find((x) => x.hero === hero), n: t.ranked.length };
};

export function heroSummary(snap: Snapshot, previous: Snapshot | null, hero: string, minGames: number): HeroSummary {
  const { r, grey } = place(snap, "all", hero, minGames);
  if (r) {
    const pr = previous ? (place(previous, "all", hero, minGames).r?.rank ?? null) : null;
    return {
      kind: "ranked",
      tier: r.tier,
      rank: r.rank,
      delta: pr === null ? null : pr - r.rank,
      prevRank: pr,
      hasPrevious: previous !== null,
      win_rate: r.row.win_rate,
      games: r.row.games,
      pick: r.row.pick,
      ban_rate: r.row.ban_rate,
    };
  }
  if (grey) return { kind: "grey", win_rate: grey.win_rate, games: grey.games, pick: grey.pick };
  // the view was collected and the hero did not play in it: a thin sample (0 games), not "no data"
  return { kind: "grey", win_rate: null, games: 0, pick: 0 };
}

export interface MapRow {
  slug: string;
  name: string;
  ko: string;
  image?: string;
  win_rate: number | null; // null = no game on this map in the view
  pick: number;
  games: number;
  thin: boolean; // games < the tier floor: the win rate is not a finding
}

/** This hero on every map the snapshot has (0 games where the hero did not play it): maps over the floor first, best
 *  win rate first; then the thin ones by games, so one lucky game never leads the list (owner 10-02, KR views). */
export function mapRows(snap: Snapshot, hero: string, maps: MapTable, minGames: number): MapRow[] {
  const inView = new Set(snap.rows.map((r) => r.map));
  return maps.maps
    .flatMap((m): MapRow[] => {
      const row = snap.rows.find((x) => x.map === m.name && x.hero === hero);
      if (row) return [{ slug: m.slug, name: m.name, ko: m.ko, image: m.image, win_rate: row.win_rate, pick: row.pick, games: row.games, thin: row.games < minGames }];
      return inView.has(m.name) ? [{ slug: m.slug, name: m.name, ko: m.ko, image: m.image, win_rate: null, pick: 0, games: 0, thin: true }] : [];
    })
    .sort((a, b) => Number(a.thin) - Number(b.thin) || (a.thin ? b.games - a.games : (b.win_rate ?? 0) - (a.win_rate ?? 0)));
}

export interface GridCell {
  bracket: Bracket; // label: messages common.brackets
  tier: Tier | null; // null = below the sample floor, or no file
  rank: number | null;
  n: number; // heroes ranked in that cell
  win_rate: number | null; // null = the hero has no games there (or no file)
  games: number;
  /** ranked · thin (under the floor) · zero (collected, no game) · uncollected (no file for that cell) */
  sample: "ranked" | "thin" | "zero" | "uncollected";
}
export interface GridRow {
  region: Region; // label: messages common.regions
  cells: GridCell[];
}
/** 지역 × 구간 on the hero page (owner 2026-10-02): this hero in every region × bracket of the mode (QM: regions only). */
export function heroGrid(
  mode: "qm" | "sl",
  cells: Record<Region, Record<Bracket, Snapshot | null>>,
  hero: string,
  minGames: number,
): { brackets: Bracket[]; rows: GridRow[] } {
  const brackets: Bracket[] = mode === "sl" ? ["all", "low", "high"] : ["all"];
  const rows = REGIONS.map((region) => ({
    region,
    cells: brackets.map((bracket): GridCell => {
      const snap = cells[region][bracket];
      const empty = { bracket, tier: null, rank: null, n: 0, win_rate: null, games: 0 };
      if (!snap) return { ...empty, sample: "uncollected" };
      const p = place(snap, "all", hero, minGames);
      const row = p.r?.row ?? p.grey;
      if (!row) return { ...empty, n: p.n, sample: "zero" };
      return { bracket, tier: p.r?.tier ?? null, rank: p.r?.rank ?? null, n: p.n, win_rate: row.win_rate, games: row.games, sample: p.r ? "ranked" : "thin" };
    }),
  }));
  return { brackets, rows };
}

export interface BuildTalentView {
  level: number;
  ko: string;
  icon?: string; // file name under img/talents/
  desc?: string;
  cd?: string;
}
/** Below this many games a build's win rate is noise (right after a patch: 1-3 games, "100 %"). */
export const BUILD_MIN_GAMES = 30;
/** Builds shown per bracket: the collector asks for ten so the score has more to choose from. */
export const BUILDS_SHOWN = 5;
const BUILD_BRACKETS: BuildBracketKey[] = ["high", "low"]; // high first: the main line

export interface BuildView {
  games: number;
  /** games < BUILD_MIN_GAMES: listed, but its win rate is not presented as a finding. */
  thin: boolean;
  win_rate: number;
  /** % of the hero's games in the bracket; null without that count. */
  pick: number | null;
  /** games relative to the most played build shown (bar length). */
  share: number;
  talents: BuildTalentView[];
}

/** The builds' views: one per Storm League bracket, and "all" (both added up) when both have builds. */
export type BuildScope = "all" | BuildBracketKey;
export type HeroBuilds = Partial<Record<BuildScope, BuildView[]>>;

function talentView(t: BuildTalent, talents: TalentTable | null, locale: Locale): BuildTalentView {
  const info = talents?.talents[t.name];
  const icon = info?.icon || undefined;
  if (locale !== DEFAULT_LOCALE) return { level: t.level, ko: localField(info, locale) ?? t.title, icon, desc: localField(info, `desc_${locale}`), cd: localField(info, `cd_${locale}`) };
  return { level: t.level, ko: info?.ko ?? t.title, icon, desc: info?.desc, cd: info?.cd };
}

/** 전체 구간 (owner 2026-10-27): the same seven talents in both brackets are one build, games and wins added up.
 *  Each bracket lists its top ten only, and games HP gives no league tier (about 23 %) are in neither. */
function mergeBrackets(lists: Build[][]): Build[] {
  const by = new Map<string, { games: number; wins: number; talents: BuildTalent[] }>();
  for (const x of lists.flat()) {
    const key = x.talents.map((t) => t.name).join("|");
    const m = by.get(key) ?? { games: 0, wins: 0, talents: x.talents };
    m.games += x.games;
    m.wins += (x.win_rate * x.games) / 100;
    by.set(key, m);
  }
  return [...by.values()].map((m) => ({ games: m.games, win_rate: m.games ? (m.wins / m.games) * 100 : 0, talents: m.talents }));
}

function view(list: Build[], heroGames: number | undefined, talents: TalentTable | null, locale: Locale): BuildView[] {
  const base = buildBase(list);
  const shown = list
    .map((x) => ({ x, score: buildScore(x.games, x.win_rate, base) }))
    .sort((p, q) => q.score - p.score || q.x.games - p.x.games)
    .slice(0, BUILDS_SHOWN)
    .map((p) => p.x);
  const max = Math.max(1, ...shown.map((x) => x.games));
  return shown.map((x) => ({
    games: x.games,
    thin: x.games < BUILD_MIN_GAMES,
    win_rate: x.win_rate,
    pick: heroGames ? (x.games / heroGames) * 100 : null,
    share: x.games / max,
    talents: x.talents.map((t) => talentView(t, talents, locale)),
  }));
}

/** Each bracket's builds sorted by the build score (formula.ts), with each talent's name, tooltip and cooldown in the
 *  page language (English from gamestrings enus; HP's English title when the game data has no entry). */
export function heroBuilds(builds: BuildsFile | null, talents: TalentTable | null, hero: string, locale: Locale): HeroBuilds {
  const out: HeroBuilds = {};
  const found = BUILD_BRACKETS.flatMap((key) => {
    const b = builds?.brackets?.[key];
    const list = b?.heroes[hero] ?? [];
    return b && list.length ? [{ key, list, n: b.hero_games[hero] }] : [];
  });
  if (found.length === BUILD_BRACKETS.length) {
    const n = found.every((f) => f.n) ? found.reduce((s, f) => s + f.n!, 0) : undefined;
    out.all = view(mergeBrackets(found.map((f) => f.list)), n, talents, locale);
  }
  for (const f of found) out[f.key] = view(f.list, f.n, talents, locale);
  return out;
}

/** Game tooltip text: {{…}} marks a highlighted value. Text parts only — nothing is parsed as HTML. */
export function descParts(desc: string | undefined, locale: Locale): { text: string; hl: boolean }[] {
  if (!desc) return [{ text: messages[locale].hero.noDesc, hl: false }];
  return desc
    .split(/\{\{(.*?)\}\}/)
    .map((text, i) => ({ text, hl: i % 2 === 1 }))
    .filter((p) => p.text);
}
