import { afterEach, describe, expect, it, vi } from "vitest";
import { computeTiers, type Row, type Snapshot } from "../src/formula";
import { loadSnapshot, type HeroTable, type Meta } from "../src/data";
import { knownOnly } from "../src/lib/known";
import { pickShown } from "../src/lib/shown";

// Issue #6: a new hero (Xal'atath, patch 2.57) is in the stats before our asset tables have it. Such a hero is
// left out everywhere — and before the tier cut, so the tiers are computed over the heroes the page shows.
const row = (hero: string, wins: number, games: number, pick: number): Row => ({
  hero,
  map: "all",
  wins,
  losses: games - wins,
  games,
  bans: 0,
  pick,
  popularity: pick,
  win_rate: (wins / games) * 100,
  ban_rate: 0,
  ci: null,
});
const heroes: HeroTable = {
  roles: [{ name: "Tank", ko: "전사" }],
  heroes: ["A", "B", "C", "D"].map((n) => ({ name: n, slug: n.toLowerCase(), ko: n, role: "Tank", role_ko: "전사" })),
};
const snap = (patch: string): Snapshot => ({
  patch,
  mode: "qm",
  game_type: "qm",
  league_tier: null,
  collected_at: "2026-09-29T00:00:00Z",
  matches: 1000,
  rows: [row("A", 600, 1000, 30), row("B", 520, 1000, 30), row("Xal'atath", 700, 1000, 70), row("C", 500, 1000, 30), row("D", 450, 1000, 30)],
});

describe("knownOnly", () => {
  it("drops rows of heroes the asset table does not have and leaves the input untouched", () => {
    const s = snap("new");
    const out = knownOnly(s, heroes);
    expect(out.rows.map((r) => r.hero)).toEqual(["A", "B", "C", "D"]);
    expect(out).toMatchObject({ patch: "new", matches: 1000 });
    expect(s.rows).toHaveLength(5);
  });

  it("the tier cut runs over the shown heroes: the unknown hero neither takes a rank nor a slot in the denominator", () => {
    const raw = computeTiers(snap("new").rows, 200).ranked;
    expect(raw[0]?.row.hero).toBe("Xal'atath"); // control: counted, it would be rank 1
    const shown = computeTiers(knownOnly(snap("new"), heroes).rows, 200).ranked;
    expect(shown.map((x) => [x.row.hero, x.rank])).toEqual([
      ["A", 1],
      ["B", 2],
      ["C", 3],
      ["D", 4],
    ]);
  });
});

describe("every snapshot entry point applies it", () => {
  const meta: Meta = {
    current_patch: "new",
    previous_patch: "old",
    patch_started_at: "2026-09-29",
    collected_at: "2026-09-29T00:00:00Z",
    min_games_for_tier: 200,
    modes: { qm: { matches: 1000, heroes: 5, heroes_over_200: 5 } },
  };

  it("pickShown (server pages): both the shown file and the ▲▼ base", () => {
    const read = (_key: string, patch: "current" | "previous") => snap(patch === "current" ? "new" : "old");
    const s = pickShown(meta, "qm", "all", read, heroes)!;
    expect(s.snap.rows.map((r) => r.hero)).not.toContain("Xal'atath");
    expect(s.previous!.rows.map((r) => r.hero)).not.toContain("Xal'atath");
  });

  afterEach(() => vi.unstubAllGlobals());

  it("loadSnapshot (tier page views loaded in the browser)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(snap("new")))));
    const s = await loadSnapshot("qm", "current", heroes);
    expect(s.rows.map((r) => r.hero)).toEqual(["A", "B", "C", "D"]);
  });
});
