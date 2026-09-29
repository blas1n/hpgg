/** Map detail view model (/hots/maps/<slug>/). Pure; computed at build time. */
import { computeTiers, PRESETS, type Snapshot, type Tier } from "../formula";
import { wilson } from "../wilson";
import type { HeroTable } from "../data";
import type { HeroRef } from "./home";

/**
 * data/maps_meta.json: each map's objective as the official site printed it (three steps), with the page it came
 * from. Heroes Profile has no map metadata; nothing here is invented, and no timings are given (no official source).
 */
export interface MapsMeta {
  _source: { objectives: string; note: string };
  maps: Record<string, { name: string; objective: { title: string; text: string }[]; source: { title: string; url: string; original: string } }>;
}

export const MAP_TOP_N = 10;

export interface MapHeroRow {
  hero: HeroRef;
  /** Tier among the heroes over the sample floor on this map (the tier table's per-map view). */
  tier: Tier;
  win_rate: number;
  /** Wilson 95 % half-width, %p. */
  wrHalf: number;
  games: number;
  pick: number;
  ban_rate: number;
}

export interface MapDetail {
  matches: number;
  /** Heroes with at least `minGames` games on this map. */
  qualified: number;
  /** Highest win rate first, among the qualified heroes. */
  top: MapHeroRow[];
}

export function mapDetail(sl: Snapshot, map: string, heroes: HeroTable, minGames: number, n = MAP_TOP_N): MapDetail {
  const by = new Map(heroes.heroes.map((h) => [h.name, h]));
  const rows = sl.rows.filter((r) => r.map === map);
  const tier = new Map(computeTiers(rows, PRESETS.aichi, minGames).ranked.map((x) => [x.row.hero, x.tier]));
  const qualified = rows.filter((r) => r.games >= minGames && by.has(r.hero));
  const top = [...qualified]
    .sort((a, b) => b.win_rate - a.win_rate || b.games - a.games)
    .slice(0, n)
    .map((r) => {
      const h = by.get(r.hero)!;
      const [lo, hi] = wilson(r.wins, r.games);
      return {
        hero: { slug: h.slug, ko: h.ko, name: h.name, role: h.role, role_ko: h.role_ko, portrait: h.portrait },
        tier: tier.get(r.hero) ?? "F",
        win_rate: r.win_rate,
        wrHalf: (hi - lo) / 2,
        games: r.games,
        pick: r.pick,
        ban_rate: r.ban_rate,
      };
    });
  // every match has ten hero slots
  return { matches: Math.round(rows.reduce((a, r) => a + r.games, 0) / 10), qualified: qualified.length, top };
}
