/** 내 영웅풀 (#28, stage D): the browser side of /v1/me/pool and what the 밴픽 page does with it. The pool is a list the
 *  member keeps (any hero, by Heroes Profile's English name — `name` in heroes_ko.json); a sync pulls this season's
 *  Storm League record and adds the heroes played `min_games` times or more. Like lib/account.ts, every call carries
 *  the session cookie and never throws: a failure is null / false / "failed". */
import { call, type Opts } from "./account";

export type SyncStatus = "ok" | "private" | "not_found" | "quota_exceeded" | "unavailable";
const SYNC_STATUSES: readonly string[] = ["ok", "private", "not_found", "quota_exceeded", "unavailable"];

export interface PoolCandidate {
  hero: string;
  games: number;
  wins: number;
}

export type SyncResult =
  | { status: SyncStatus; stale: boolean; season: number | null; minGames: number; added: string[]; addedRecords: PoolCandidate[]; candidates: PoolCandidate[] }
  | { status: "region_required" }
  | { status: "failed" };

const isObj = (o: unknown): o is Record<string, unknown> => !!o && typeof o === "object" && !Array.isArray(o);
const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;
const isNames = (a: unknown): a is string[] => Array.isArray(a) && a.every((x) => typeof x === "string");
const isCandidate = (c: unknown): c is PoolCandidate => isObj(c) && typeof c.hero === "string" && isInt(c.games) && isInt(c.wins);

const json = async (r: Response): Promise<unknown> => r.json().catch(() => null);

/** The member's pool in the order added, or null (signed out, an error, an answer of another shape). */
export async function getPool(opts: Opts = {}): Promise<string[] | null> {
  const r = await call("/v1/me/pool", { method: "GET" }, opts);
  if (r?.status !== 200) return null;
  const body = await json(r);
  if (!isObj(body) || !Array.isArray(body.heroes) || !body.heroes.every((h) => isObj(h) && typeof h.hero === "string")) return null;
  return (body.heroes as { hero: string }[]).map((h) => h.hero);
}

/** Puts a hero in (`include`) or takes it out; true when saved. */
export async function setPoolHero(hero: string, include: boolean, opts: Opts = {}): Promise<boolean> {
  const r = await call("/v1/me/pool", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hero, in: include }) }, opts);
  return r?.status === 204;
}

export async function clearPool(opts: Opts = {}): Promise<boolean> {
  return (await call("/v1/me/pool", { method: "DELETE" }, opts))?.status === 204;
}

/** Fills the pool from this season's record. "region_required": the member has not said where they play. */
export async function syncPool(opts: Opts = {}): Promise<SyncResult> {
  const r = await call("/v1/me/pool/sync", { method: "POST" }, opts);
  if (!r) return { status: "failed" };
  const body = await json(r);
  if (r.status === 409) {
    const code = isObj(body) && isObj(body.error) ? body.error.code : null;
    return code === "region_required" ? { status: "region_required" } : { status: "failed" };
  }
  if (r.status !== 200 || !isObj(body)) return { status: "failed" };
  const { status, stale, season, min_games, added, candidates } = body;
  // the record of each added hero; absent from a server older than the site (they deploy apart)
  const records = body.added_records ?? [];
  if (
    typeof status !== "string" ||
    !SYNC_STATUSES.includes(status) ||
    typeof stale !== "boolean" ||
    !(season === null || isInt(season)) ||
    !isInt(min_games) ||
    !isNames(added) ||
    !Array.isArray(candidates) ||
    !candidates.every(isCandidate) ||
    !Array.isArray(records) ||
    !records.every(isCandidate)
  )
    return { status: "failed" };
  return {
    status: status as SyncStatus,
    stale,
    season,
    minGames: min_games,
    added,
    addedRecords: records.map((c) => ({ hero: c.hero, games: c.games, wins: c.wins })),
    candidates: candidates.map((c) => ({ hero: c.hero, games: c.games, wins: c.wins })),
  };
}

/** "내 영웅풀만": our team's pick suggestions inside the pool; a ban or the other team's pick is left as it is. */
export function onlyPool<T extends { hero: { name: string } }>(suggestions: readonly T[], pool: readonly string[], step: { kind: "ban" | "pick"; ours: boolean }): T[] {
  if (step.kind !== "pick" || !step.ours) return [...suggestions];
  const mine = new Set(pool);
  return suggestions.filter((s) => mine.has(s.hero.name));
}

/** The 밴픽 page's two tabs; the pool tab is linked as ?tab=pool next to the draft's own query. */
export type DraftTab = "draft" | "pool";
const TAB_PARAM = "tab";

export const readTab = (search: string): DraftTab => (new URLSearchParams(search).get(TAB_PARAM) === "pool" ? "pool" : "draft");

export function withTab(query: string, tab: DraftTab): string {
  const q = new URLSearchParams(query);
  q.delete(TAB_PARAM);
  if (tab === "pool") q.set(TAB_PARAM, "pool");
  return q.toString();
}

/** "내 영웅풀만" is remembered per browser; storage that throws (private window) reads as off. */
export const ONLY_POOL_KEY = "hpgg-draft-only-pool";
export function readOnlyPool(storage: () => Pick<Storage, "getItem"> = () => localStorage): boolean {
  try {
    return storage().getItem(ONLY_POOL_KEY) === "1";
  } catch {
    return false;
  }
}
export function writeOnlyPool(on: boolean, storage: () => Pick<Storage, "setItem"> = () => localStorage): void {
  try {
    storage().setItem(ONLY_POOL_KEY, on ? "1" : "0");
  } catch {
    // not remembered: off again on the next visit
  }
}
