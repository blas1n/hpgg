/** Battle.net sign-in (#28): the browser side of server/accounts. The site (hpgg.win) and the API (api.hpgg.win) are
 *  different origins on the same site, so every call carries the session cookie (`credentials: "include"`). The
 *  pages are static: whether someone is signed in is only known in the browser, and any failure reads as signed out —
 *  the page then stays what it is for every visitor. */
import { apiBase, isRegion, type Region } from "./players";

export interface Me {
  battletag: string;
  /** chosen by the member; Battle.net does not say where they play */
  region: Region | null;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
type Opts = { fetch?: Fetch };

export type LoginOutcome = "failed" | "cancelled";
const LOGIN_PARAM = "login";

/** Removes `?login=` (the API's word on the last sign-in) from a path + query (+ hash), keeping everything else. */
export function withoutLoginParam(pathAndQuery: string): string {
  const u = new URL(pathAndQuery, "https://hpgg.win");
  if (!u.searchParams.has(LOGIN_PARAM)) return pathAndQuery;
  u.searchParams.delete(LOGIN_PARAM);
  return u.pathname + u.search + u.hash;
}

/** The API starts the Battle.net sign-in and sends the browser back to `nextPath` on the site. */
export const loginUrl = (nextPath: string): string =>
  `${apiBase()}/v1/auth/battlenet/login?${new URLSearchParams({ next: withoutLoginParam(nextPath) })}`;

/** "failed" | "cancelled" when the API sent the browser back without a session; anything else is no outcome. */
export function loginOutcome(search: string): LoginOutcome | null {
  const v = new URLSearchParams(search).get(LOGIN_PARAM);
  return v === "failed" || v === "cancelled" ? v : null;
}

/** "name#1234" → "name" (the header on phones). */
export const battletagName = (battletag: string): string => battletag.split("#")[0] ?? battletag;

const BATTLETAG = /^[^\s#]+#\d+$/u;
const isMe = (o: unknown): o is Me => {
  const m = o as Record<string, unknown> | null;
  return !!m && typeof m === "object" && typeof m.battletag === "string" && BATTLETAG.test(m.battletag) && (m.region === null || (typeof m.region === "string" && isRegion(m.region)));
};

async function call(path: string, init: RequestInit, opts: Opts): Promise<Response | null> {
  try {
    return await (opts.fetch ?? fetch)(`${apiBase()}${path}`, { ...init, credentials: "include", signal: AbortSignal.timeout(15_000) });
  } catch {
    return null;
  }
}

/** The signed-in member, or null: signed out, an error, no network or an answer of another shape. Never throws. */
export async function fetchMe(opts: Opts = {}): Promise<Me | null> {
  const r = await call("/v1/me", { method: "GET" }, opts);
  if (r?.status !== 200) return null;
  const body = (await r.json().catch(() => null)) as unknown;
  return isMe(body) ? { battletag: body.battletag, region: body.region } : null;
}

export async function chooseRegion(region: Region, opts: Opts = {}): Promise<boolean> {
  const r = await call("/v1/me/region", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ region }) }, opts);
  return r?.status === 204;
}

export async function logout(opts: Opts = {}): Promise<boolean> {
  return (await call("/v1/auth/logout", { method: "POST" }, opts))?.status === 204;
}

/** Deletes the account and its sessions; the member's comments stay, without the link to the account. */
export async function deleteAccount(opts: Opts = {}): Promise<boolean> {
  return (await call("/v1/me", { method: "DELETE" }, opts))?.status === 204;
}
