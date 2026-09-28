/** Home page view models. Pure: computed at build time for each mode and serialised into the page. */
import { computeTiers, PRESETS, type Ranked, type Snapshot, type Tier } from "../formula";
import type { HeroInfo, HeroTable, MapTable } from "../data";

export type HeroRef = Pick<HeroInfo, "slug" | "ko" | "name" | "role" | "role_ko" | "portrait">;

export interface LeaderCard {
  role: string;
  role_ko: string;
  hero: HeroRef;
  tier: Tier;
  rank: number;
  win_rate: number;
  pick: number;
  ban_rate: number;
}

export interface TopRow {
  hero: HeroRef;
  tier: Tier;
  rank: number;
  win_rate: number;
  pick: number;
  ban_rate: number;
  games: number;
  /** previous rank − current rank (positive = climbed); null without a previous patch or when unranked there. */
  delta: number | null;
}

export interface Mover {
  hero: HeroRef;
  tier: Tier;
  rank: number;
  prevRank: number;
  delta: number;
  win_rate: number;
  prevWinRate: number;
}

export interface MapCard {
  slug: string;
  name: string;
  ko: string;
  image?: string;
  matches: number;
  top: { hero: HeroRef; tier: Tier }[];
}

function refIndex(heroes: HeroTable): Map<string, HeroRef> {
  return new Map(heroes.heroes.map((h) => [h.name, { slug: h.slug, ko: h.ko, name: h.name, role: h.role, role_ko: h.role_ko, portrait: h.portrait }]));
}

export function roleLeaders(ranked: Ranked[], heroes: HeroTable): LeaderCard[] {
  const refs = refIndex(heroes);
  const out: LeaderCard[] = [];
  for (const role of heroes.roles) {
    const top = ranked.find((x) => refs.get(x.row.hero)?.role === role.name);
    if (!top) continue;
    out.push({
      role: role.name,
      role_ko: role.ko,
      hero: refs.get(top.row.hero)!,
      tier: top.tier,
      rank: top.rank,
      win_rate: top.row.win_rate,
      pick: top.row.pick,
      ban_rate: top.row.ban_rate,
    });
  }
  return out;
}

export function topHeroes(ranked: Ranked[], previous: Ranked[] | null, heroes: HeroTable, n: number): TopRow[] {
  const refs = refIndex(heroes);
  const prevRank = new Map(previous?.map((x) => [x.row.hero, x.rank]) ?? []);
  return ranked
    .filter((x) => refs.has(x.row.hero))
    .slice(0, n)
    .map((x) => {
      const p = prevRank.get(x.row.hero);
      return {
        hero: refs.get(x.row.hero)!,
        tier: x.tier,
        rank: x.rank,
        win_rate: x.row.win_rate,
        pick: x.row.pick,
        ban_rate: x.row.ban_rate,
        games: x.row.games,
        delta: previous && p !== undefined ? p - x.rank : null,
      };
    });
}

export function movers(ranked: Ranked[], previous: Ranked[], heroes: HeroTable, limit: number): { up: Mover[]; down: Mover[] } {
  const refs = refIndex(heroes);
  const prev = new Map(previous.map((x) => [x.row.hero, x]));
  const all: Mover[] = [];
  for (const x of ranked) {
    const p = prev.get(x.row.hero);
    const hero = refs.get(x.row.hero);
    if (!p || !hero || p.rank === x.rank) continue;
    all.push({ hero, tier: x.tier, rank: x.rank, prevRank: p.rank, delta: p.rank - x.rank, win_rate: x.row.win_rate, prevWinRate: p.row.win_rate });
  }
  return {
    up: all.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta || a.rank - b.rank).slice(0, limit),
    down: all.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta || a.rank - b.rank).slice(0, limit),
  };
}

export function mapCards(sl: Snapshot, maps: MapTable, heroes: HeroTable, minGames: number, n: number): MapCard[] {
  const refs = refIndex(heroes);
  return maps.maps
    .map((m) => {
      const rows = sl.rows.filter((r) => r.map === m.name);
      // every match has ten hero slots
      const matches = Math.round(rows.reduce((a, r) => a + r.games, 0) / 10);
      const top = computeTiers(rows, PRESETS.aichi, minGames)
        .ranked.filter((x) => refs.has(x.row.hero))
        .slice(0, 3)
        .map((x) => ({ hero: refs.get(x.row.hero)!, tier: x.tier }));
      return { slug: m.slug, name: m.name, ko: m.ko, image: m.image, matches, top };
    })
    .filter((c) => c.matches > 0)
    .sort((a, b) => b.matches - a.matches)
    .slice(0, n);
}

export interface HomeModel {
  mode: "qm" | "sl";
  patch: string;
  matches: number;
  collectedAt: string;
  previousPatch: string | null;
  leaders: LeaderCard[];
  top: TopRow[];
  movers: { up: Mover[]; down: Mover[] } | null;
}

/** One mode's home sections. `previous` is the same mode on the previous patch (null before the first patch change). */
export function homeModel(mode: "qm" | "sl", snap: Snapshot, previous: Snapshot | null, previousPatch: string | null, heroes: HeroTable, minGames: number): HomeModel {
  const rank = (s: Snapshot) => computeTiers(s.rows.filter((r) => r.map === "all"), PRESETS.aichi, minGames).ranked;
  const cur = rank(snap);
  const prev = previous ? rank(previous) : null;
  return {
    mode,
    patch: snap.patch,
    matches: snap.matches,
    collectedAt: snap.collected_at,
    previousPatch: prev ? previousPatch : null,
    leaders: roleLeaders(cur, heroes),
    top: topHeroes(cur, prev, heroes, 10),
    movers: prev ? movers(cur, prev, heroes, 8) : null,
  };
}
