/** Player search (전적 검색): API client and view model. The API is our server (api.hpgg.win), which
 * calls Heroes Profile /players with the key and caches the answer; see docs/HANDOFF.md "Server". */
import type { HeroInfo, HeroTable, MapTable } from "../data";
import { localizedPath, type Locale } from "../i18n/locale";
import { messages } from "../i18n/messages";

export const API_BASE_DEFAULT = "https://api.hpgg.win";
const apiBase = (): string => process.env.NEXT_PUBLIC_API_BASE || API_BASE_DEFAULT;

export type Region = "KR" | "NA" | "EU";
/** Asia (KR) first; labels: messages players.regions. */
export const REGIONS: Region[] = ["KR", "NA", "EU"];
export const isRegion = (s: string | null | undefined): s is Region => REGIONS.some((r) => r === s);

/** Same rule as the server: a name without spaces or '#', then '#' and 3-8 digits. */
const BATTLETAG = /^[^\s#]{1,24}#\d{3,8}$/u;

/** Normalises what people type (spaces, full-width ＃) and returns null when it cannot be a BattleTag. */
export function parseBattletag(input: string): string | null {
  const s = input.trim().replace(/＃/g, "#").replace(/\s*#\s*/g, "#");
  return BATTLETAG.test(s) ? s : null;
}

export const playersHref = (locale: Locale, tag?: string, region?: Region): string =>
  localizedPath("/hots/players/", locale) + (tag ? `?${new URLSearchParams({ tag, region: region ?? "KR" })}` : "");

// --- API shapes (server/players/profile.py) ---
export interface ModeStat {
  mode: string;
  mmr: number | null;
  tier: string | null;
  wins: number;
  losses: number;
  win_rate: number | null;
}
export interface HeroStat {
  hero: string;
  short_name: string | null;
  games: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  last_played: string | null;
}
export interface MapStat {
  map: string;
  games: number;
  wins: number;
  losses: number;
  win_rate: number | null;
}
export interface MatchStat {
  replay_id: number | null;
  date: string | null;
  mode: string | null;
  map: string | null;
  hero: string | null;
  short_name: string | null;
  win: boolean;
  mmr_change: number | null;
}
export interface PlayerProfile {
  battletag: string;
  region: string;
  account_level: number | null;
  wins: number;
  losses: number;
  win_rate: number | null;
  kda: number | null;
  mvp_rate: number | null;
  modes: ModeStat[];
  roles: { role: string; win_rate: number }[];
  heroes_most_played: HeroStat[];
  heroes_best: HeroStat[];
  maps_most_played: MapStat[];
  recent_matches: MatchStat[];
}
export type Notice = "quota_exceeded" | "upstream_unavailable";
export interface PlayerResponse {
  player: PlayerProfile;
  fetched_at: string;
  stale: boolean;
  notice: Notice | null;
}

export type PlayerResult =
  | { kind: "ok"; data: PlayerResponse }
  | { kind: "not_found" }
  | { kind: "quota"; retryAfter: number | null }
  | { kind: "rate_limited"; retryAfter: number | null }
  | { kind: "invalid" }
  | { kind: "error" } // the API answered but Heroes Profile did not
  | { kind: "offline" }; // no API answer at all (not deployed yet, down, or timed out)

export interface FetchOptions {
  base?: string;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

export async function fetchPlayer(battletag: string, region: Region, opts: FetchOptions = {}): Promise<PlayerResult> {
  const url = `${opts.base ?? apiBase()}/v1/players?${new URLSearchParams({ battletag, region })}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 12_000);
  let res: Response;
  let body: unknown;
  try {
    res = await (opts.fetchImpl ?? fetch)(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    body = await res.json();
  } catch {
    return { kind: "offline" }; // network error, abort, or a non-JSON page (Cloudflare error while the host is not live)
  } finally {
    clearTimeout(timer);
  }
  const code = (body as { error?: { code?: string } } | null)?.error?.code;
  const retryAfter = Number(res.headers.get("retry-after")) || null;
  if (res.ok) return isResponse(body) ? { kind: "ok", data: body } : { kind: "error" };
  if (res.status === 404) return { kind: "not_found" };
  if (res.status === 422) return { kind: "invalid" };
  if (res.status === 429) return code === "quota_exceeded" ? { kind: "quota", retryAfter } : { kind: "rate_limited", retryAfter };
  return { kind: "error" };
}

const isResponse = (b: unknown): b is PlayerResponse =>
  typeof b === "object" && b !== null && typeof (b as PlayerResponse).player === "object" && (b as PlayerResponse).player !== null;

// --- labels ---
type ModeKey = keyof (typeof messages)["ko"]["players"]["modes"];
/** HP mode codes (ud = Unranked Draft, ar = ARAM) as the game names them; unknown codes pass through. */
export const modeLabel = (mode: string | null, locale: Locale): string => {
  if (!mode) return "–";
  const modes = messages[locale].players.modes;
  return mode in modes ? modes[mode as ModeKey] : mode;
};

type LeagueKey = keyof (typeof messages)["ko"]["players"]["leagues"];
/** HP league name (lower case prefix) → our key, which is also the colour key. Grand Master before Master. */
const LEAGUE: [string, LeagueKey][] = [
  ["grand master", "grandmaster"],
  ["master", "master"],
  ["diamond", "diamond"],
  ["platinum", "platinum"],
  ["gold", "gold"],
  ["silver", "silver"],
  ["bronze", "bronze"],
];
const league = (tier: string | null) => (tier ? LEAGUE.find(([hp]) => tier.toLowerCase().startsWith(hp)) : undefined);

/** "Diamond 2" → "다이아몬드 2" / "Diamond 2"; unknown names pass through. */
export function tierLabel(tier: string | null, locale: Locale): string | null {
  if (!tier) return null;
  const l = league(tier);
  return l ? (messages[locale].players.leagues[l[1]] + tier.slice(l[0].length)).trim() : tier;
}

/** HP match dates are UTC "YYYY-MM-DD HH:MM:SS". */
export function relativeDay(date: string | null, locale: Locale, now = new Date()): string {
  if (!date) return "";
  const t = Date.parse(date.replace(" ", "T") + "Z");
  if (Number.isNaN(t)) return "";
  const p = messages[locale].players;
  const min = Math.floor((now.getTime() - t) / 60_000);
  if (min < 60) return p.minutesAgo(String(Math.max(0, min)));
  if (min < 24 * 60) return p.hoursAgo(String(Math.floor(min / 60)));
  const days = Math.floor(min / (24 * 60));
  return days <= 30 ? p.daysAgo(String(days)) : date.slice(0, 10);
}

// --- view model ---
export interface HeroRow {
  name: string;
  slug: string | null;
  portrait?: string;
  role?: string;
  href: string | null;
  games: number;
  winRate: number | null;
}
export interface PlayerView {
  name: string;
  tag: string;
  regionLabel: string;
  level: number | null;
  games: number;
  wins: number;
  losses: number;
  winRate: number | null;
  kda: number | null;
  mvpRate: number | null;
  modes: { mode: string; label: string; mmr: number | null; tier: string | null; tierKey: string | null; games: number; wins: number; losses: number; winRate: number | null }[];
  roles: { role: string; label: string; winRate: number }[];
  heroes: HeroRow[];
  bestHeroes: HeroRow[];
  maps: { name: string; games: number; winRate: number | null }[];
  matches: { key: string; hero: string; slug: string | null; portrait?: string; role?: string; mode: string; map: string; win: boolean; mmrChange: number | null; when: string }[];
  recent: { wins: number; losses: number };
  stale: boolean;
  notice: Notice | null;
  fetchedLabel: string;
}

/** `heroes` / `maps` in the page language (i18n/names.ts): their display names are what the page shows. */
export function playerView(r: PlayerResponse, heroes: HeroTable, maps: MapTable, locale: Locale, now = new Date()): PlayerView {
  const t = messages[locale].players;
  const p = r.player;
  const byShort = new Map<string, HeroInfo>();
  for (const h of heroes.heroes) {
    if (h.short_name) byShort.set(h.short_name, h);
    byShort.set(h.name, h);
  }
  const hero = (name: string | null, short: string | null) => (short && byShort.get(short)) || (name ? byShort.get(name) : undefined);
  // ARAM maps have no stats page but do show up in match history
  const mapKo = new Map([...maps.maps, ...(maps.aram ?? [])].map((m) => [m.name, m.ko]));
  const heroRow = (s: HeroStat): HeroRow => {
    const h = hero(s.hero, s.short_name);
    return { name: h?.ko ?? s.hero, slug: h?.slug ?? null, portrait: h?.portrait, role: h?.role, href: h ? localizedPath(`/hots/heroes/${h.slug}/`, locale) : null, games: s.games, winRate: s.win_rate };
  };
  const roleKo = new Map(heroes.roles.map((x) => [x.name, x.ko]));
  const roleOrder = heroes.roles.map((x) => x.name);
  const [name, disc] = p.battletag.split("#");
  const fetched = new Date(r.fetched_at);
  const kst = new Date(fetched.getTime() + 9 * 3600_000).toISOString();
  return {
    name: name ?? p.battletag,
    tag: disc ? `#${disc}` : "",
    regionLabel: isRegion(p.region) ? t.regions[p.region] : p.region,
    level: p.account_level,
    games: p.wins + p.losses,
    wins: p.wins,
    losses: p.losses,
    winRate: p.win_rate,
    kda: p.kda,
    mvpRate: p.mvp_rate,
    modes: p.modes.map((m) => ({
      mode: m.mode,
      label: modeLabel(m.mode, locale),
      mmr: m.mmr,
      tier: tierLabel(m.tier, locale),
      tierKey: league(m.tier)?.[1] ?? null,
      games: m.wins + m.losses,
      wins: m.wins,
      losses: m.losses,
      winRate: m.win_rate,
    })),
    roles: [...p.roles]
      .sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role))
      .map((x) => ({ role: x.role, label: roleKo.get(x.role) ?? x.role, winRate: x.win_rate })),
    heroes: p.heroes_most_played.map(heroRow),
    bestHeroes: p.heroes_best.map(heroRow),
    maps: p.maps_most_played.map((m) => ({ name: mapKo.get(m.map) ?? m.map, games: m.games, winRate: m.win_rate })),
    matches: p.recent_matches.map((m, i) => {
      const h = hero(m.hero, m.short_name);
      return {
        key: `${m.replay_id ?? "m"}-${i}`,
        hero: h?.ko ?? m.hero ?? "–",
        slug: h?.slug ?? null,
        portrait: h?.portrait,
        role: h?.role,
        mode: modeLabel(m.mode, locale),
        map: m.map ? (mapKo.get(m.map) ?? m.map) : "–",
        win: m.win,
        mmrChange: m.mmr_change,
        when: relativeDay(m.date, locale, now),
      };
    }),
    recent: { wins: p.recent_matches.filter((m) => m.win).length, losses: p.recent_matches.filter((m) => !m.win).length },
    stale: r.stale,
    notice: r.notice,
    fetchedLabel: t.fetched(`${kst.slice(5, 7)}/${kst.slice(8, 10)} ${kst.slice(11, 16)}`),
  };
}
