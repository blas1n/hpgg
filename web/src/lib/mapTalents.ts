/** A hero's talent tree on one map (영웅 상세, owner 2026-11-05): GET /v1/heroes/talents on our API. The server asks
 *  Heroes Profile (/heroes/talents/details) the first time a hero, map and bracket is wanted and keeps the answer a
 *  week, so the first visitor waits ~2 s and the rest get it at once (server/heroes/talents.py). Storm League only. */
import type { TalentTable } from "../data";
import { DEFAULT_LOCALE, type Locale } from "../i18n/locale";
import { localField } from "../i18n/names";
import { BUILD_MIN_GAMES } from "./hero";
import { apiGet, type ApiResult, type FetchOptions } from "./players";

export interface MapTalentRow {
  talent: string;
  games: number;
  wins: number;
  popularity: number;
  win_rate: number;
}

export interface MapTalentsResponse {
  hero: string;
  map: string;
  tier: string;
  patch: string;
  builds: string;
  /** "1", "4" … "20": the level's talents, most played first. */
  levels: Record<string, MapTalentRow[]>;
  fetched_at: string;
  stale: boolean;
  notice: string | null;
}

export interface MapTalentView {
  talent: string;
  name: string;
  icon?: string;
  desc?: string;
  cd?: string;
  games: number;
  win_rate: number;
  /** % of the level's games. */
  pick: number;
  /** games relative to the level's most picked talent (bar length). */
  share: number;
  /** games < BUILD_MIN_GAMES: listed, but its win rate is not presented as a finding (the builds' rule). */
  thin: boolean;
}

export interface MapTalentLevel {
  level: number;
  games: number;
  rows: MapTalentView[];
}

const isResponse = (b: unknown): b is MapTalentsResponse => {
  const r = b as MapTalentsResponse | null;
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.levels === "object" &&
    r.levels !== null &&
    Object.values(r.levels).every((l) => Array.isArray(l) && l.every((t) => typeof t?.talent === "string" && typeof t.games === "number" && typeof t.win_rate === "number"))
  );
};

/** The patch line the server takes (2.57.0): builds.json named one build (2.55.17.98025) before 2026-10-01. */
export const patchLine = (patch: string): string => patch.split(".").slice(0, 3).join(".");

/** HP names the hero and the map (HeroInfo.name, MapInfo.name); tier is the page's bracket. A cold one takes a job. */
export const fetchMapTalents = (hero: string, map: string, tier: string, patch: string, opts: FetchOptions = {}): Promise<ApiResult<MapTalentsResponse>> =>
  apiGet("/v1/heroes/talents", { hero, map, tier, patch }, isResponse, { timeoutMs: 30_000, ...opts });

export function mapTalentTree(r: MapTalentsResponse, talents: TalentTable | null, locale: Locale): { levels: MapTalentLevel[] } {
  const levels = Object.keys(r.levels)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
    .map((level): MapTalentLevel => {
      const list = [...(r.levels[String(level)] ?? [])].sort((a, b) => b.games - a.games);
      const games = list.reduce((s, t) => s + t.games, 0);
      const max = Math.max(1, ...list.map((t) => t.games));
      const rows = list.map((t): MapTalentView => {
        const info = talents?.talents[t.talent];
        const en = locale !== DEFAULT_LOCALE;
        return {
          talent: t.talent,
          name: (en ? localField(info, locale) : info?.ko) ?? t.talent,
          icon: info?.icon || undefined,
          desc: en ? localField(info, `desc_${locale}`) : info?.desc,
          cd: en ? localField(info, `cd_${locale}`) : info?.cd,
          games: t.games,
          win_rate: t.win_rate,
          pick: games ? (t.games / games) * 100 : 0,
          share: t.games / max,
          thin: t.games < BUILD_MIN_GAMES,
        };
      });
      return { level, games, rows };
    });
  return { levels };
}
