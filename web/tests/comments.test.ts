import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteComment, fetchComments, postComment, readNickname, rememberNickname, reportComment } from "../src/lib/comments";

// Comments on the weekly report and hero pages (owner 2026-10-05) — the browser side of server/comments.

const res = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

afterEach(() => vi.restoreAllMocks());

describe("comments client", () => {
  it("lists a thread", async () => {
    const f = vi.fn(async () => res(200, { count: 1, comments: [{ id: 1, nickname: "a", tag: "1a2b", body: "b", created_at: "2026-10-05T03:00:00Z" }] }));
    const r = await fetchComments("weekly:2026-w40", { fetch: f });
    expect(r).toMatchObject({ kind: "ok", count: 1 });
    expect(String((f.mock.calls[0] as unknown as [string])[0])).toContain("/v1/comments?thread=weekly%3A2026-w40");
  });

  it("an answer that is not a comment list is an error, not a crash", async () => {
    expect(await fetchComments("hero:valla", { fetch: async () => res(200, { player: {} }) })).toEqual({ kind: "error" });
    expect(await fetchComments("hero:valla", { fetch: async () => { throw new TypeError("offline"); } })).toEqual({ kind: "offline" });
  });

  it("posts JSON with the hidden field, and reads the server's refusals", async () => {
    const f = vi.fn(async () => res(201, { id: 7, nickname: "a", tag: "1a2b", body: "b", created_at: "2026-10-05T03:00:00Z" }));
    const ok = await postComment({ thread: "hero:valla", nickname: "a", password: "1234", body: "b", website: "" }, { fetch: f });
    expect(ok).toMatchObject({ kind: "ok", comment: { id: 7 } });
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({ website: "" });
    const bad = await postComment({ thread: "hero:valla", nickname: "운영자", password: "1234", body: "b", website: "" }, { fetch: async () => res(422, { error: { code: "invalid_parameters", message: "잘못된 입력: body, nickname" } }) });
    expect(bad).toEqual({ kind: "invalid", fields: ["body", "nickname"] });
    const slow = await postComment({ thread: "hero:valla", nickname: "a", password: "1234", body: "b", website: "" }, { fetch: async () => res(429, { error: { code: "rate_limited", message: "" } }, { "retry-after": "120" }) });
    expect(slow).toEqual({ kind: "rate_limited", retryAfter: 120 });
  });

  it("delete: the password decides; report: done or gone", async () => {
    expect(await deleteComment(7, "1234", { fetch: async () => res(204) })).toEqual({ kind: "ok" });
    expect(await deleteComment(7, "x", { fetch: async () => res(403, { error: { code: "wrong_password", message: "" } }) })).toEqual({ kind: "wrong_password" });
    expect(await deleteComment(7, "x", { fetch: async () => res(404, { error: { code: "comment_not_found", message: "" } }) })).toEqual({ kind: "not_found" });
    expect(await reportComment(7, { fetch: async () => res(204) })).toEqual({ kind: "ok" });
  });

  it("remembers the nickname for the next comment; blocked storage is no nickname", () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(readNickname()).toBe("");
    rememberNickname("잘아타스장인");
    expect(readNickname()).toBe("잘아타스장인");
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
    expect(readNickname()).toBe("");
    expect(() => rememberNickname("a")).not.toThrow();
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
});
