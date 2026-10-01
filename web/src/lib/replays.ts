/** One game in full (전적 검색, a game card opened): GET /v1/replays/<id> (server/players/replays.py) → both teams. */
import type { AwardTable, HeroInfo, HeroTable, TalentTable } from "../data";
import { awardView, type AwardView } from "./awards";
import { DEFAULT_LOCALE, type Locale } from "../i18n/locale";
import { localField } from "../i18n/names";
import { TALENT_LEVELS, type MatchTalent } from "./matches";
export { awardView, type AwardView } from "./awards";
import { apiGet, isRegion, playersHref, type ApiResult, type FetchOptions } from "./players";

// --- API shape ---
export interface ReplayPlayer {
  battletag: string | null;
  hero: string;
  short_name: string | null;
  role: string | null;
  party: string | null;
  award: string | null;
  mmr: number | null;
  mmr_change: number | null;
  level: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  takedowns: number | null;
  hero_damage: number | null;
  siege_damage: number | null;
  structure_damage: number | null;
  healing: number | null;
  self_healing: number | null;
  damage_taken: number | null;
  experience: number | null;
  time_spent_dead: number | null;
  time_cc: number | null;
  merc_camps: number | null;
  talents: (string | null)[];
}
export interface Replay {
  replay_id: number;
  date: string | null;
  mode: string | null;
  map: string | null;
  length_s: number | null;
  region: string | null;
  teams: { team: number; win: boolean; players: ReplayPlayer[] }[];
}
export interface ReplayResponse {
  replay: Replay;
  fetched_at: string;
}

const isReplay = (b: unknown): b is ReplayResponse =>
  typeof b === "object" &&
  b !== null &&
  typeof (b as ReplayResponse).replay === "object" &&
  (b as ReplayResponse).replay !== null &&
  Array.isArray((b as ReplayResponse).replay.teams);

export const fetchReplay = (replayId: number, opts: FetchOptions = {}): Promise<ApiResult<ReplayResponse>> =>
  apiGet(`/v1/replays/${replayId}`, {}, isReplay, opts);

/** 1215 → "20:15". */
export const gameLength = (s: number | null): string => (s === null ? "–" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

// --- view ---
export interface ReplayPlayerView {
  key: string;
  me: boolean;
  name: string;
  tag: string;
  href: string | null;
  hero: string;
  slug: string | null;
  portrait?: string;
  role?: string;
  /** parties in the game, numbered 0, 1 … in order of appearance; null = queued alone */
  party: number | null;
  award: AwardView | null;
  level: number | null;
  kda: { kills: number; deaths: number; assists: number } | null;
  heroDamage: number | null;
  siegeDamage: number | null;
  healing: number | null;
  damageTaken: number | null;
  experience: number | null;
  mmrChange: number | null;
  talents: MatchTalent[];
}
export interface ReplayView {
  length: string;
  teams: { win: boolean; players: ReplayPlayerView[] }[];
}

/** `me` is the searched BattleTag (any letter case): their team comes first and their row is marked. */
export function replayView(
  r: Replay,
  heroes: HeroTable,
  awards: AwardTable | null,
  talents: Record<string, TalentTable | null>,
  locale: Locale,
  me: string,
): ReplayView {
  const by = new Map<string, HeroInfo>();
  for (const h of heroes.heroes) {
    if (h.short_name) by.set(h.short_name, h);
    by.set(h.name, h);
  }
  const mine = me.toLowerCase();
  const region = isRegion(r.region) ? r.region : null;
  const parties: string[] = []; // HP names a party by a colour word; only grouping is kept
  const party = (p: string | null) => (p ? (parties.includes(p) ? parties.indexOf(p) : parties.push(p) - 1) : null);
  const teams = r.teams.map((t) => ({
    win: t.win,
    players: t.players.map((p, i): ReplayPlayerView => {
      const h = (p.short_name && by.get(p.short_name)) || by.get(p.hero);
      const [name, disc] = (p.battletag ?? "").split("#");
      const table = h ? talents[h.slug] : null;
      return {
        key: `${t.team}-${i}`,
        me: !!p.battletag && p.battletag.toLowerCase() === mine,
        name: name || "–",
        tag: disc ? `#${disc}` : "",
        href: p.battletag && region ? playersHref(locale, p.battletag, region) : null,
        hero: h?.ko ?? p.hero,
        slug: h?.slug ?? null,
        portrait: h?.portrait,
        role: h?.role,
        party: party(p.party),
        award: awardView(p.award, awards, locale),
        level: p.level,
        kda: p.kills !== null && p.deaths !== null && p.assists !== null ? { kills: p.kills, deaths: p.deaths, assists: p.assists } : null,
        heroDamage: p.hero_damage,
        siegeDamage: p.siege_damage,
        healing: p.healing,
        damageTaken: p.damage_taken,
        experience: p.experience,
        mmrChange: p.mmr_change,
        talents: TALENT_LEVELS.map((level, j) => {
          const id = p.talents[j] ?? null;
          const info = id && table ? table.talents[id] : undefined;
          if (!info) return { level, name: null };
          return { level, name: locale === DEFAULT_LOCALE ? info.ko : (localField(info, locale) ?? info.ko), icon: info.icon || undefined };
        }),
      };
    }),
  }));
  teams.sort((a, b) => Number(b.players.some((p) => p.me)) - Number(a.players.some((p) => p.me)));
  return { length: gameLength(r.length_s), teams };
}
