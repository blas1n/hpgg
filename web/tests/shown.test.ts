import { describe, expect, it } from "vitest";
import type { Snapshot } from "../src/formula";
import type { HeroTable, Meta } from "../src/data";
import { bracketMatches, pickShown } from "../src/lib/shown";

const snap = (patch: string, league_tier: number[] | null = null): Snapshot => ({ patch, mode: "sl", game_type: "sl", league_tier, collected_at: "2026-09-29T00:00:00Z", matches: 1, rows: [] });
/** `reference`: meta.reference_patch — the one patch the whole site shows (collector build_meta). */
const meta = (reference: string | undefined, previous: string | null = "old", thinSl = false): Meta => ({
  current_patch: "new",
  previous_patch: previous,
  ...(reference ? { reference_patch: reference } : {}),
  patch_started_at: "2026-09-29",
  collected_at: "2026-09-29T00:00:00Z",
  min_games_for_tier: 200,
  modes: { qm: { matches: 1, heroes: 90, heroes_ranked: 80, heroes_over_200: 80 }, sl: { matches: 1, heroes: 90, heroes_ranked: thinSl ? 0 : 80, heroes_over_200: thinSl ? 0 : 80 } },
});
const heroes: HeroTable = { roles: [], heroes: [] }; // rows are empty here; lib/known.ts is covered in known.test.ts
const files = (entries: Record<string, Snapshot>) => (key: string, patch: "current" | "previous") => entries[`${patch}/${key}`] ?? null;

describe("bracketMatches", () => {
  it("a bracket file is only that bracket when its league tiers are the current definition", () => {
    expect(bracketMatches(snap("x", [1, 2, 3, 4]), "low")).toBe(true);
    expect(bracketMatches(snap("x", [4, 3, 2, 1]), "low")).toBe(true);
    expect(bracketMatches(snap("x", [1, 2]), "low")).toBe(false); // the 2026-09-28 definition
    expect(bracketMatches(snap("x", [5, 6]), "high")).toBe(true);
    expect(bracketMatches(snap("x", null), "all")).toBe(true);
    expect(bracketMatches(snap("x", [1, 2, 3, 4]), "all")).toBe(false);
  });
});

describe("pickShown: one reference patch for every view (owner 2026-09-29)", () => {
  const all = files({ "current/qm": snap("new"), "previous/qm": snap("old"), "current/sl": snap("new"), "previous/sl": snap("old") });

  it("reference = current: the current patch, with the previous one for ▲▼", () => {
    expect(pickShown(meta("new"), "qm", "all", all, heroes)).toMatchObject({ snap: { patch: "new" }, previous: { patch: "old" }, fallback: false });
  });

  it("reference = previous: the previous patch, flagged, and no ▲▼ base", () => {
    expect(pickShown(meta("old"), "qm", "all", all, heroes)).toMatchObject({ snap: { patch: "old" }, previous: null, fallback: true });
  });

  it("a view never decides for itself: a thin Storm League sample under a current reference stays current", () => {
    expect(pickShown(meta("new", "old", true), "sl", "all", all, heroes)).toMatchObject({ snap: { patch: "new" }, fallback: false });
  });

  it("no reference recorded (meta from before it existed) or no previous patch: the current one", () => {
    expect(pickShown(meta(undefined), "qm", "all", all, heroes)).toMatchObject({ snap: { patch: "new" }, fallback: false });
    expect(pickShown(meta("old", null), "qm", "all", all, heroes)).toMatchObject({ snap: { patch: "new" }, fallback: false });
  });

  it("a view with no file on the reference patch shows nothing — never another patch in its place", () => {
    const read = files({ "current/sl_low": snap("new", [1, 2, 3, 4]), "previous/sl_low": snap("old", [1, 2]) });
    expect(pickShown(meta("old"), "sl", "low", read, heroes)).toBeNull(); // the previous file is of another bracket definition
    expect(pickShown(meta("new"), "sl", "low", read, heroes)).toMatchObject({ snap: { patch: "new" }, previous: null }); // and no ▲▼ against it
  });

  it("nothing valid to show: null", () => {
    expect(pickShown(meta("new"), "sl", "high", files({ "current/sl_high": snap("new", [5]) }), heroes)).toBeNull();
  });
});
