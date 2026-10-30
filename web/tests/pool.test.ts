import { describe, expect, it, vi } from "vitest";
import { clearPool, getPool, ONLY_POOL_KEY, onlyPool, readOnlyPool, readTab, setPoolHero, syncPool, withTab, writeOnlyPool } from "../src/lib/pool";

// 내 영웅풀 (#28, stage D): the browser side of /v1/me/pool. Every call carries the session cookie and never throws.

const res = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
type Call = [string, RequestInit];

describe("pool client", () => {
  it("GET /v1/me/pool: the heroes in the order added, with the cookie", async () => {
    const f = vi.fn(async () => res(200, { heroes: [{ hero: "Valla" }, { hero: "Li Li" }, { hero: "Lúcio" }] }));
    expect(await getPool({ fetch: f })).toEqual(["Valla", "Li Li", "Lúcio"]);
    const [url, init] = f.mock.calls[0] as unknown as Call;
    expect(url).toBe("https://api.hpgg.win/v1/me/pool");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    expect(await getPool({ fetch: async () => res(200, { heroes: [] }) })).toEqual([]);
  });

  it("GET /v1/me/pool: signed out, an error, no network or another shape is null — never a throw", async () => {
    expect(await getPool({ fetch: async () => res(401, { error: { code: "not_signed_in" } }) })).toBeNull();
    expect(await getPool({ fetch: async () => res(500) })).toBeNull();
    expect(await getPool({ fetch: async () => { throw new TypeError("offline"); } })).toBeNull();
    expect(await getPool({ fetch: async () => new Response("<html>", { status: 200 }) })).toBeNull();
    for (const body of [{}, { heroes: "Valla" }, { heroes: [{ hero: 7 }] }, { heroes: ["Valla"] }, null, []]) {
      expect(await getPool({ fetch: async () => res(200, body) }), JSON.stringify(body)).toBeNull();
    }
  });

  it("POST /v1/me/pool adds or removes one hero; true only on 204", async () => {
    const f = vi.fn(async () => res(204));
    expect(await setPoolHero("Li Li", true, { fetch: f })).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as Call;
    expect(url).toBe("https://api.hpgg.win/v1/me/pool");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({ hero: "Li Li", in: true });
    await setPoolHero("Valla", false, { fetch: f });
    expect(JSON.parse(String((f.mock.calls[1] as unknown as Call)[1].body))).toEqual({ hero: "Valla", in: false });
    expect(await setPoolHero("Valla", true, { fetch: async () => res(401) })).toBe(false);
    expect(await setPoolHero("Valla", true, { fetch: async () => { throw new TypeError("offline"); } })).toBe(false);
  });

  it("DELETE /v1/me/pool clears; true only on 204", async () => {
    const f = vi.fn(async () => res(204));
    expect(await clearPool({ fetch: f })).toBe(true);
    expect(f.mock.calls[0]).toMatchObject(["https://api.hpgg.win/v1/me/pool", { method: "DELETE", credentials: "include" }]);
    expect(await clearPool({ fetch: async () => res(500) })).toBe(false);
    expect(await clearPool({ fetch: async () => { throw new TypeError("offline"); } })).toBe(false);
  });

  it("POST /v1/me/pool/sync: the season's heroes added and the candidates under the minimum", async () => {
    const body = {
      status: "ok",
      stale: false,
      season: 13,
      min_games: 5,
      added: ["Valla", "Li Li", "Lúcio"],
      candidates: [{ hero: "Zeratul", games: 4, wins: 3 }, { hero: "Abathur", games: 1, wins: 0 }],
    };
    const f = vi.fn(async () => res(200, body));
    expect(await syncPool({ fetch: f })).toEqual({
      status: "ok",
      stale: false,
      season: 13,
      minGames: 5,
      added: ["Valla", "Li Li", "Lúcio"],
      candidates: [{ hero: "Zeratul", games: 4, wins: 3 }, { hero: "Abathur", games: 1, wins: 0 }],
    });
    const [url, init] = f.mock.calls[0] as unknown as Call;
    expect(url).toBe("https://api.hpgg.win/v1/me/pool/sync");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
  });

  it("sync: every status the server names comes through, with nothing added", async () => {
    for (const status of ["private", "not_found", "quota_exceeded", "unavailable"] as const) {
      const r = await syncPool({ fetch: async () => res(200, { status, stale: false, season: null, min_games: 5, added: [], candidates: [] }) });
      expect(r).toMatchObject({ status, added: [], candidates: [] });
    }
    expect(await syncPool({ fetch: async () => res(200, { status: "ok", stale: true, season: 13, min_games: 5, added: [], candidates: [] }) })).toMatchObject({ status: "ok", stale: true });
  });

  it("sync: 409 region_required asks for the region; anything else is a failure — never a throw", async () => {
    expect(await syncPool({ fetch: async () => res(409, { error: { code: "region_required", message: "" } }) })).toEqual({ status: "region_required" });
    expect(await syncPool({ fetch: async () => res(409, { error: { code: "other" } }) })).toEqual({ status: "failed" });
    expect(await syncPool({ fetch: async () => res(401) })).toEqual({ status: "failed" });
    expect(await syncPool({ fetch: async () => res(500) })).toEqual({ status: "failed" });
    expect(await syncPool({ fetch: async () => { throw new TypeError("offline"); } })).toEqual({ status: "failed" });
    for (const body of [
      {},
      { status: "weird", stale: false, season: null, min_games: 5, added: [], candidates: [] },
      { status: "ok", stale: false, season: 13, min_games: 5, added: "Valla", candidates: [] },
      { status: "ok", stale: false, season: 13, min_games: 5, added: [], candidates: [{ hero: "Zeratul", games: "4", wins: 3 }] },
      { status: "ok", stale: "no", season: 13, min_games: 5, added: [], candidates: [] },
      null,
    ]) {
      expect(await syncPool({ fetch: async () => res(200, body) }), JSON.stringify(body)).toEqual({ status: "failed" });
    }
  });
});

describe("onlyPool: our pick suggestions inside the hero pool", () => {
  const s = (name: string) => ({ hero: { name }, score: 0 });
  const list = [s("Johanna"), s("Li Li"), s("Valla"), s("Anduin"), s("Zeratul")];
  const pool = ["Valla", "Li Li", "Lúcio"];

  it("our pick: only pool heroes, in the suggestions' order", () => {
    expect(onlyPool(list, pool, { kind: "pick", ours: true }).map((x) => x.hero.name)).toEqual(["Li Li", "Valla"]);
  });

  it("a ban or the other team's pick: unchanged", () => {
    expect(onlyPool(list, pool, { kind: "ban", ours: true })).toEqual(list);
    expect(onlyPool(list, pool, { kind: "ban", ours: false })).toEqual(list);
    expect(onlyPool(list, pool, { kind: "pick", ours: false })).toEqual(list);
  });

  it("an empty pool leaves nothing to suggest for our pick", () => {
    expect(onlyPool(list, [], { kind: "pick", ours: true })).toEqual([]);
  });
});

describe("tab in the address", () => {
  it("reads ?tab=pool, anything else is the draft", () => {
    expect(readTab("?tab=pool")).toBe("pool");
    expect(readTab("?d=illidan&tab=pool")).toBe("pool");
    expect(readTab("")).toBe("draft");
    expect(readTab("?tab=other")).toBe("draft");
  });

  it("adds the tab to the draft's query and drops it for the draft tab", () => {
    expect(withTab("", "pool")).toBe("tab=pool");
    expect(withTab("map=Cursed+Hollow&d=illidan", "pool")).toBe("map=Cursed+Hollow&d=illidan&tab=pool");
    expect(withTab("map=Cursed+Hollow", "draft")).toBe("map=Cursed+Hollow");
    expect(withTab("", "draft")).toBe("");
  });
});

describe("the 내 영웅풀만 switch is remembered per browser", () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  const throwing = () => {
    throw new Error("SecurityError: storage is disabled");
  };

  it("off by default, on once written, off again", () => {
    const s = store();
    expect(readOnlyPool(() => s)).toBe(false);
    writeOnlyPool(true, () => s);
    expect(s.m.get(ONLY_POOL_KEY)).toBe("1");
    expect(readOnlyPool(() => s)).toBe(true);
    writeOnlyPool(false, () => s);
    expect(readOnlyPool(() => s)).toBe(false);
  });

  it("storage that throws reads as off and writing does not break", () => {
    expect(readOnlyPool(throwing)).toBe(false);
    expect(() => writeOnlyPool(true, throwing)).not.toThrow();
  });
});
