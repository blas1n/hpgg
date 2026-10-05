/** Comments on the weekly report and hero pages (owner 2026-10-05): the browser side of server/comments. Anonymous —
 *  a nickname and a password to delete with; the server keeps no address and no password. */
import { apiBase } from "./players";

export interface CommentItem {
  id: number;
  nickname: string;
  /** 4 characters from a hash of the writer's address: same nickname, different people */
  tag: string;
  body: string;
  created_at: string;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
type Opts = { fetch?: Fetch };
type Common = { kind: "rate_limited"; retryAfter: number | null } | { kind: "error" } | { kind: "offline" };

export type ListResult = { kind: "ok"; count: number; comments: CommentItem[] } | Common;
export type PostResult = { kind: "ok"; comment: CommentItem } | { kind: "invalid"; fields: string[] } | Common;
export type DeleteResult = { kind: "ok" } | { kind: "wrong_password" } | { kind: "not_found" } | Common;
export type ReportResult = { kind: "ok" } | { kind: "not_found" } | Common;

const isComment = (c: unknown): c is CommentItem => {
  const o = c as Record<string, unknown> | null;
  return !!o && typeof o.id === "number" && typeof o.nickname === "string" && typeof o.tag === "string" && typeof o.body === "string" && typeof o.created_at === "string";
};

async function call(path: string, init: RequestInit | undefined, opts: Opts): Promise<Response | null> {
  try {
    return await (opts.fetch ?? fetch)(`${apiBase()}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch {
    return null;
  }
}

const retryAfter = (r: Response): number | null => {
  const v = Number(r.headers.get("retry-after"));
  return Number.isFinite(v) && v > 0 ? v : null;
};

async function common(r: Response | null): Promise<Common> {
  if (!r) return { kind: "offline" };
  if (r.status === 429) return { kind: "rate_limited", retryAfter: retryAfter(r) };
  return { kind: "error" };
}

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export async function fetchComments(thread: string, opts: Opts = {}): Promise<ListResult> {
  const r = await call(`/v1/comments?${new URLSearchParams({ thread })}`, undefined, opts);
  if (!r?.ok) return common(r);
  const body = (await r.json().catch(() => null)) as { count?: unknown; comments?: unknown } | null;
  if (!body || !Array.isArray(body.comments) || !body.comments.every(isComment)) return { kind: "error" };
  return { kind: "ok", count: body.comments.length, comments: body.comments };
}

export interface NewComment {
  thread: string;
  nickname: string;
  password: string;
  body: string;
  /** the hidden field a person never fills (a bot does) */
  website: string;
}

export async function postComment(c: NewComment, opts: Opts = {}): Promise<PostResult> {
  const r = await call("/v1/comments", json(c), opts);
  if (r?.status === 201) {
    const body = (await r.json().catch(() => null)) as unknown;
    return isComment(body) ? { kind: "ok", comment: body } : { kind: "error" };
  }
  if (r?.status === 422) {
    // server/errors.py: "잘못된 입력: body, nickname"
    const msg = ((await r.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? "";
    const fields = msg.includes(":") ? msg.slice(msg.indexOf(":") + 1).split(",").map((s) => s.trim()).filter(Boolean) : [];
    return { kind: "invalid", fields };
  }
  return common(r);
}

export async function deleteComment(id: number, password: string, opts: Opts = {}): Promise<DeleteResult> {
  const r = await call(`/v1/comments/${id}/delete`, json({ password }), opts);
  if (r?.status === 204) return { kind: "ok" };
  if (r?.status === 403) return { kind: "wrong_password" };
  if (r?.status === 404) return { kind: "not_found" };
  return common(r);
}

export async function reportComment(id: number, opts: Opts = {}): Promise<ReportResult> {
  const r = await call(`/v1/comments/${id}/report`, { method: "POST" }, opts);
  if (r?.status === 204) return { kind: "ok" };
  if (r?.status === 404) return { kind: "not_found" };
  return common(r);
}

const NICK_KEY = "hpgg-nick";

/** The nickname used last, for the next comment (browser storage; blocked storage = none). */
export function readNickname(): string {
  try {
    return localStorage.getItem(NICK_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberNickname(nick: string): void {
  try {
    localStorage.setItem(NICK_KEY, nick);
  } catch {
    // not remembered: typed again next time
  }
}
