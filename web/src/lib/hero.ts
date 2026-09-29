/** Hero detail view models. Pure: computed at build time for both modes and serialised into each hero page. */
import { computeTiers, PRESETS, type Snapshot, type Tier } from "../formula";
import type { BuildsFile, MapTable, Region, TalentTable } from "../data";
import type { Locale } from "../i18n/locale";
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
  | { kind: "grey"; win_rate: number; games: number; pick: number }
  | { kind: "none" };

const place = (snap: Snapshot, map: string, hero: string, minGames: number) => {
  const t = computeTiers(snap.rows.filter((r) => r.map === map), PRESETS.aichi, minGames);
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
  return { kind: "none" };
}

export interface MapRow {
  slug: string;
  name: string;
  ko: string;
  image?: string;
  win_rate: number;
  pick: number;
  games: number;
  thin: boolean;
}

/** This hero on every map the snapshot has, best win rate first. */
export function mapRows(snap: Snapshot, hero: string, maps: MapTable, minGames: number): MapRow[] {
  return maps.maps
    .flatMap((m) => {
      const row = snap.rows.find((x) => x.map === m.name && x.hero === hero);
      return row ? [{ slug: m.slug, name: m.name, ko: m.ko, image: m.image, win_rate: row.win_rate, pick: row.pick, games: row.games, thin: row.games < minGames }] : [];
    })
    .sort((a, b) => b.win_rate - a.win_rate);
}

export interface BracketRow {
  key: "low" | "high"; // label: messages common.brackets
  tier: Tier | null; // null = below the sample floor in that bracket
  rank: number | null;
  n: number;
  win_rate: number;
  pick: number;
  ban_rate: number;
  games: number;
}

export function bracketRows(brackets: { key: "low" | "high"; snap: Snapshot | null }[], hero: string, minGames: number): BracketRow[] {
  return brackets.flatMap(({ key, snap }) => {
    if (!snap) return [];
    const p = place(snap, "all", hero, minGames);
    const row = p.r?.row ?? p.grey;
    if (!row) return [];
    return [{ key, tier: p.r?.tier ?? null, rank: p.r?.rank ?? null, n: p.n, win_rate: row.win_rate, pick: row.pick, ban_rate: row.ban_rate, games: row.games }];
  });
}

export interface RegionRow {
  key: Exclude<Region, "all">; // label: messages common.regions
  tier: Tier | null; // null = below the sample floor in that region
  rank: number | null;
  n: number;
  win_rate: number;
  pick: number;
  games: number;
  /** Regions rotate one a day, so each has its own date. */
  collectedAt: string;
}

/** This hero in each collected region (current mode, every bracket). A region not collected yet has no row. */
export function regionRows(regions: { key: Exclude<Region, "all">; snap: Snapshot | null }[], hero: string, minGames: number): RegionRow[] {
  return regions.flatMap(({ key, snap }) => {
    if (!snap) return [];
    const p = place(snap, "all", hero, minGames);
    const row = p.r?.row ?? p.grey;
    if (!row) return [];
    return [{ key, tier: p.r?.tier ?? null, rank: p.r?.rank ?? null, n: p.n, win_rate: row.win_rate, pick: row.pick, games: row.games, collectedAt: snap.collected_at }];
  });
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

export interface BuildView {
  games: number;
  /** games < BUILD_MIN_GAMES: listed, but its win rate is not presented as a finding. */
  thin: boolean;
  win_rate: number;
  /** games relative to the most played build (bar length). */
  share: number;
  talents: BuildTalentView[];
}

/** Each talent's name, tooltip and cooldown in the page language (English from gamestrings enus; HP's English
 *  title when the game data has no entry). */
export function heroBuilds(builds: BuildsFile | null, talents: TalentTable | null, hero: string, locale: Locale): BuildView[] {
  const list = builds?.heroes[hero] ?? [];
  const max = Math.max(1, ...list.map((b) => b.games));
  return list.map((b) => ({
    games: b.games,
    thin: b.games < BUILD_MIN_GAMES,
    win_rate: b.win_rate,
    share: b.games / max,
    talents: b.talents.map((t) => {
      const info = talents?.talents[t.name];
      const icon = info?.icon || undefined;
      if (locale === "en") return { level: t.level, ko: info?.en ?? t.title, icon, desc: info?.desc_en, cd: info?.cd_en };
      return { level: t.level, ko: info?.ko ?? t.title, icon, desc: info?.desc, cd: info?.cd };
    }),
  }));
}

/** Game tooltip text: {{…}} marks a highlighted value. Text parts only — nothing is parsed as HTML. */
export function descParts(desc: string | undefined, locale: Locale): { text: string; hl: boolean }[] {
  if (!desc) return [{ text: messages[locale].hero.noDesc, hl: false }];
  return desc
    .split(/\{\{(.*?)\}\}/)
    .map((text, i) => ({ text, hl: i % 2 === 1 }))
    .filter((p) => p.text);
}
