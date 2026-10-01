/** A player's games (전적 검색): API client, the briefing over the newest games and the per-game rows.
 * The API is GET /v1/players/matches (server/players/matches.py): `full` rows carry the stat line and talents
 * (Heroes Profile /players/matches), `basic` rows only hero, map, result and MMR (HP's MMR history). */
import type { HeroInfo, HeroTable, MapTable, TalentTable } from "../data";
import { DEFAULT_LOCALE, type Locale } from "../i18n/locale";
import { localField } from "../i18n/names";
import { apiGet, modeLabel, relativeDay, type ApiResult, type FetchOptions, type Notice, type Region } from "./players";

/** How many of the newest games the briefing covers. */
export const BRIEFING_GAMES = 20;
/** Talent tiers in the game, in the order the API lists a game's seven talents. */
export const TALENT_LEVELS = [1, 4, 7, 10, 13, 16, 20] as const;

// --- API shape (server/players/match_rows.py) ---
export interface MatchRow {
  replay_id: number;
  date: string | null;
  hero: string;
  short_name: string | null;
  win: boolean | null;
  mode: string | null;
  map: string | null;
  role: string | null;
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
  first_to_ten: boolean | null;
  talents: (string | null)[];
}
export interface MatchesResponse {
  source: "full" | "basic";
  matches: MatchRow[];
  fetched_at: string;
  stale: boolean;
  notice: Notice | null;
}
export type MatchesResult = ApiResult<MatchesResponse>;

const isMatches = (b: unknown): b is MatchesResponse => typeof b === "object" && b !== null && Array.isArray((b as MatchesResponse).matches);

export const fetchMatches = (battletag: string, region: Region, opts: FetchOptions = {}): Promise<MatchesResult> =>
  // a cold query waits on Heroes Profile's job (server polls up to 20 s)
  apiGet("/v1/players/matches", battletag, region, isMatches, {
    timeoutMs: 30_000,
    ...opts,
  });

// --- shared lookups ---
function heroIndex(heroes: HeroTable) {
  const by = new Map<string, HeroInfo>();
  for (const h of heroes.heroes) {
    if (h.short_name) by.set(h.short_name, h);
    by.set(h.name, h);
  }
  return (name: string, short: string | null) => (short && by.get(short)) || by.get(name);
}
const has = (m: MatchRow) => m.kills !== null && m.deaths !== null && m.assists !== null;
const ratio = (k: number, d: number, a: number) => (k + a) / Math.max(1, d);

// --- briefing ---
export interface Briefing {
  games: number;
  wins: number;
  losses: number;
  winRate: number | null;
  /** (kills + assists) / deaths over the games with a stat line; null when none has one */
  kda: number | null;
  avg: {
    kills: number;
    deaths: number;
    assists: number;
    heroDamage: number;
    siegeDamage: number;
    damageTaken: number;
    experience: number;
    healing: number | null;
  } | null;
  heroes: {
    name: string;
    slug: string | null;
    portrait?: string;
    role?: string;
    games: number;
    wins: number;
    losses: number;
    kda: number | null;
  }[];
  roles: { role: string; label: string; games: number; wins: number }[];
  /** MMR after each game of the most played mode, oldest first, over every loaded game */
  mmr: {
    mode: string | null;
    label: string;
    points: { date: string; mmr: number; win: boolean | null; hero: string }[];
  };
}

export function briefing(rows: MatchRow[], heroes: HeroTable, locale: Locale): Briefing {
  const hero = heroIndex(heroes);
  const recent = rows.slice(0, BRIEFING_GAMES);
  const wins = recent.filter((m) => m.win === true).length;
  const losses = recent.filter((m) => m.win === false).length;
  const lined = recent.filter(has);
  const sum = (f: (m: MatchRow) => number | null, of = lined) => of.reduce((n, m) => n + (f(m) ?? 0), 0);
  const healed = lined.filter((m) => m.healing !== null && m.healing > 0);
  const avg = lined.length
    ? {
        kills: sum((m) => m.kills) / lined.length,
        deaths: sum((m) => m.deaths) / lined.length,
        assists: sum((m) => m.assists) / lined.length,
        heroDamage: sum((m) => m.hero_damage) / lined.length,
        siegeDamage: sum((m) => m.siege_damage) / lined.length,
        damageTaken: sum((m) => m.damage_taken) / lined.length,
        experience: sum((m) => m.experience) / lined.length,
        healing: healed.length ? sum((m) => m.healing, healed) / healed.length : null,
      }
    : null;

  const byHero = new Map<string, MatchRow[]>();
  for (const m of recent) byHero.set(m.hero, [...(byHero.get(m.hero) ?? []), m]);
  const heroRows = [...byHero.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([name, ms]) => {
      const h = hero(name, ms[0]!.short_name);
      const l = ms.filter(has);
      return {
        name: h?.ko ?? name,
        slug: h?.slug ?? null,
        portrait: h?.portrait,
        role: h?.role,
        games: ms.length,
        wins: ms.filter((m) => m.win === true).length,
        losses: ms.filter((m) => m.win === false).length,
        kda: l.length
          ? ratio(
              sum((m) => m.kills, l),
              sum((m) => m.deaths, l),
              sum((m) => m.assists, l),
            )
          : null,
      };
    });

  const roleKo = new Map(heroes.roles.map((r) => [r.name, r.ko]));
  const byRole = new Map<string, { games: number; wins: number }>();
  for (const m of recent) {
    const role = m.role ?? hero(m.hero, m.short_name)?.role;
    if (!role) continue;
    const r = byRole.get(role) ?? { games: 0, wins: 0 };
    byRole.set(role, {
      games: r.games + 1,
      wins: r.wins + (m.win === true ? 1 : 0),
    });
  }
  const roles = [...byRole.entries()].sort((a, b) => b[1].games - a[1].games).map(([role, r]) => ({ role, label: roleKo.get(role) ?? role, ...r }));

  const modeGames = new Map<string, number>();
  for (const m of rows) if (m.mode && m.mmr !== null) modeGames.set(m.mode, (modeGames.get(m.mode) ?? 0) + 1);
  const mode = [...modeGames.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const points = rows
    .filter((m) => m.mode === mode && m.mmr !== null && m.date)
    .map((m) => ({
      date: m.date!,
      mmr: m.mmr!,
      win: m.win,
      hero: hero(m.hero, m.short_name)?.ko ?? m.hero,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return {
    games: recent.length,
    wins,
    losses,
    winRate: wins + losses ? (wins / (wins + losses)) * 100 : null,
    kda: lined.length
      ? ratio(
          sum((m) => m.kills),
          sum((m) => m.deaths),
          sum((m) => m.assists),
        )
      : null,
    avg,
    heroes: heroRows,
    roles,
    mmr: { mode, label: modeLabel(mode, locale), points },
  };
}

// --- per-game rows ---
export interface MatchTalent {
  level: number;
  name: string | null;
  icon?: string;
  desc?: string;
}
export interface MatchView {
  key: string;
  hero: string;
  slug: string | null;
  portrait?: string;
  role?: string;
  win: boolean | null;
  mode: string;
  map: string;
  when: string;
  mmr: number | null;
  mmrChange: number | null;
  level: number | null;
  kda: {
    kills: number;
    deaths: number;
    assists: number;
    ratio: number;
    perfect: boolean;
  } | null;
  stats: {
    heroDamage: number | null;
    siegeDamage: number | null;
    healing: number | null;
    selfHealing: number | null;
    damageTaken: number | null;
    experience: number | null;
    timeDead: number | null;
    mercCamps: number | null;
  } | null;
  talents: MatchTalent[];
}

/** `talents` maps a hero slug to its talent file (data/talents/<slug>.json) once loaded; a game whose hero's file is
 *  not loaded yet shows its talent tiers without names. */
export function matchRows(
  rows: MatchRow[],
  heroes: HeroTable,
  maps: MapTable,
  talents: Record<string, TalentTable | null>,
  locale: Locale,
  now = new Date(),
): MatchView[] {
  const hero = heroIndex(heroes);
  const mapName = new Map([...maps.maps, ...(maps.aram ?? [])].map((m) => [m.name, m.ko]));
  return rows.map((m, i) => {
    const h = hero(m.hero, m.short_name);
    const table = h ? talents[h.slug] : null;
    return {
      key: `${m.replay_id}-${i}`,
      hero: h?.ko ?? m.hero,
      slug: h?.slug ?? null,
      portrait: h?.portrait,
      role: h?.role,
      win: m.win,
      mode: modeLabel(m.mode, locale),
      map: m.map ? (mapName.get(m.map) ?? m.map) : "–",
      when: relativeDay(m.date, locale, now),
      mmr: m.mmr,
      mmrChange: m.mmr_change,
      level: m.level,
      kda: has(m)
        ? {
            kills: m.kills!,
            deaths: m.deaths!,
            assists: m.assists!,
            ratio: ratio(m.kills!, m.deaths!, m.assists!),
            perfect: m.deaths === 0,
          }
        : null,
      stats: has(m)
        ? {
            heroDamage: m.hero_damage,
            siegeDamage: m.siege_damage,
            healing: m.healing,
            selfHealing: m.self_healing,
            damageTaken: m.damage_taken,
            experience: m.experience,
            timeDead: m.time_spent_dead,
            mercCamps: m.merc_camps,
          }
        : null,
      talents: m.talents.length
        ? TALENT_LEVELS.map((level, j) => {
            const id = m.talents[j] ?? null;
            const info = id && table ? table.talents[id] : undefined;
            if (!info) return { level, name: null };
            if (locale === DEFAULT_LOCALE)
              return {
                level,
                name: info.ko,
                icon: info.icon || undefined,
                desc: info.desc,
              };
            return {
              level,
              name: localField(info, locale) ?? info.ko,
              icon: info.icon || undefined,
              desc: localField(info, `desc_${locale}`),
            };
          })
        : [],
    };
  });
}
