import { describe, expect, it, vi } from "vitest";
import { battletagName, chooseRegion, deleteAccount, fetchMe, loginOutcome, loginUrl, logout, withoutLoginParam } from "../src/lib/account";

// Battle.net sign-in (#28, stage B): the browser side of server/accounts. The site (hpgg.win) and the API
// (api.hpgg.win) are different origins: every call carries the session cookie (credentials: "include").

const res = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
type Call = [string, RequestInit];

describe("account client", () => {
  it("the login link goes to the API with the page to come back to", () => {
    const u = new URL(loginUrl("/ko/hots/players/?tag=Zemill%231940&region=NA"));
    expect(u.origin).toBe("https://api.hpgg.win");
    expect(u.pathname).toBe("/v1/auth/battlenet/login");
    expect(u.searchParams.get("next")).toBe("/ko/hots/players/?tag=Zemill%231940&region=NA");
  });

  it("the login link never carries an old ?login= outcome back", () => {
    expect(new URL(loginUrl("/en/hots/?login=failed")).searchParams.get("next")).toBe("/en/hots/");
    expect(new URL(loginUrl("/en/hots/tier/?mode=sl&login=cancelled")).searchParams.get("next")).toBe("/en/hots/tier/?mode=sl");
  });

  it("/v1/me: a member with or without a region, sent with the cookie", async () => {
    const f = vi.fn(async () => res(200, { battletag: "blAs1N#3479", region: "KR" }));
    expect(await fetchMe({ fetch: f })).toEqual({ battletag: "blAs1N#3479", region: "KR" });
    const [url, init] = f.mock.calls[0] as unknown as Call;
    expect(url).toBe("https://api.hpgg.win/v1/me");
    expect(init.credentials).toBe("include");
    expect(await fetchMe({ fetch: async () => res(200, { battletag: "blAs1N#3479", region: null }) })).toEqual({ battletag: "blAs1N#3479", region: null });
  });

  it("/v1/me: signed out, an error, no network or an answer of another shape is 'not signed in' — never a throw", async () => {
    expect(await fetchMe({ fetch: async () => res(401, { error: { code: "not_signed_in" } }) })).toBeNull();
    expect(await fetchMe({ fetch: async () => res(500) })).toBeNull();
    expect(await fetchMe({ fetch: async () => { throw new TypeError("offline"); } })).toBeNull();
    expect(await fetchMe({ fetch: async () => new Response("<html>", { status: 200 }) })).toBeNull();
    for (const body of [{}, { battletag: 7, region: null }, { battletag: "no-hash", region: null }, { battletag: "a#1", region: "CN" }, { battletag: "a#1" }, null, []]) {
      expect(await fetchMe({ fetch: async () => res(200, body) }), JSON.stringify(body)).toBeNull();
    }
  });

  it("choosing a region posts JSON with the cookie; 204 is done, anything else is not", async () => {
    const f = vi.fn(async () => res(204));
    expect(await chooseRegion("EU", { fetch: f })).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as Call;
    expect(url).toBe("https://api.hpgg.win/v1/me/region");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(String(init.body))).toEqual({ region: "EU" });
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(await chooseRegion("KR", { fetch: async () => res(401) })).toBe(false);
    expect(await chooseRegion("KR", { fetch: async () => { throw new TypeError("offline"); } })).toBe(false);
  });

  it("logout and account deletion: the right method, the cookie, true only on 204", async () => {
    const out = vi.fn(async () => res(204));
    expect(await logout({ fetch: out })).toBe(true);
    expect(out.mock.calls[0]).toMatchObject(["https://api.hpgg.win/v1/auth/logout", { method: "POST", credentials: "include" }]);
    const del = vi.fn(async () => res(204));
    expect(await deleteAccount({ fetch: del })).toBe(true);
    expect(del.mock.calls[0]).toMatchObject(["https://api.hpgg.win/v1/me", { method: "DELETE", credentials: "include" }]);
    expect(await deleteAccount({ fetch: async () => res(401) })).toBe(false);
    expect(await logout({ fetch: async () => { throw new TypeError("offline"); } })).toBe(false);
  });

  it("reads the sign-in outcome the API sends the browser back with", () => {
    expect(loginOutcome("?login=failed")).toBe("failed");
    expect(loginOutcome("?tag=a%231234&login=cancelled")).toBe("cancelled");
    expect(loginOutcome("")).toBeNull();
    expect(loginOutcome("?login=ok")).toBeNull();
    expect(loginOutcome("?login=<script>")).toBeNull();
  });

  it("removes only the login parameter from the address, keeping the rest", () => {
    expect(withoutLoginParam("/ko/hots/?login=failed")).toBe("/ko/hots/");
    expect(withoutLoginParam("/ko/hots/players/?tag=Zemill%231940&login=cancelled&region=NA#x")).toBe("/ko/hots/players/?tag=Zemill%231940&region=NA#x");
    expect(withoutLoginParam("/ko/hots/tier/?mode=sl")).toBe("/ko/hots/tier/?mode=sl");
  });

  it("the name part of a BattleTag (the header on phones)", () => {
    expect(battletagName("blAs1N#3479")).toBe("blAs1N");
  });
});

// The privacy policy (/hots/privacy/) states what server/accounts does; these tie its claims to the server's own values.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { messages } from "../src/i18n/messages";

const server = (rel: string) => readFileSync(fileURLToPath(new URL(`../../server/${rel}`, import.meta.url)), "utf-8");

describe("privacy policy matches the server", () => {
  const router = server("accounts/router.py");
  const config = server("config.py");
  const text = (l: "ko" | "en") => JSON.stringify(messages[l].privacy);

  it("names the two cookies the server sets, with their lifetimes", () => {
    const session = router.match(/SESSION_COOKIE = "([^"]+)"/)![1]!;
    const state = router.match(/STATE_COOKIE = "([^"]+)"/)![1]!;
    expect(config).toMatch(/session_ttl_seconds: int = 30 \* 86_400/);
    expect(config).toMatch(/oauth_state_ttl_seconds: int = 600/);
    for (const l of ["ko", "en"] as const) {
      expect(text(l)).toContain(session);
      expect(text(l)).toContain(state);
    }
    expect(text("ko")).toContain("30일");
    expect(text("ko")).toContain("10분");
    expect(text("en")).toContain("30 days");
    expect(text("en")).toContain("10 minutes");
  });

  it("names the contact address, the privacy officer and the effective date in both languages", () => {
    for (const l of ["ko", "en"] as const) {
      expect(text(l)).toContain("contact@hpgg.win");
      expect(text(l)).toContain("2026-10-30");
    }
    expect(text("ko")).toContain("개인정보 보호책임자");
    expect(text("en")).toContain("Privacy officer");
  });
});
