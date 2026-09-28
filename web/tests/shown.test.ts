import { describe, expect, it } from "vitest";
import type { Snapshot } from "../src/formula";
import type { Meta } from "../src/data";
import { bracketMatches, pickShown } from "../src/lib/shown";

const snap = (patch: string, league_tier: number[] | null = null): Snapshot => ({ patch, mode: "sl", game_type: "sl", league_tier, collected_at: "2026-09-29T00:00:00Z", matches: 1, rows: [] });
const meta = (thin: boolean, previous: string | null = "old"): Meta => ({
  current_patch: "new",
  previous_patch: previous,
  patch_started_at: "2026-09-29",
  collected_at: "2026-09-29T00:00:00Z",
  min_games_for_tier: 200,
  modes: { qm: { matches: 1, heroes: 90, heroes_over_200: thin ? 1 : 80 }, sl: { matches: 1, heroes: 90, heroes_over_200: thin ? 0 : 80 } },
});
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

describe("pickShown", () => {
  const all = files({ "current/qm": snap("new"), "previous/qm": snap("old") });

  it("healthy sample: the current patch, with the previous one for ▲▼", () => {
    expect(pickShown(meta(false), "qm", "all", all)).toMatchObject({ snap: { patch: "new" }, previous: { patch: "old" }, fallback: false });
  });

  it("thin sample right after a patch: the previous patch, flagged, and no ▲▼ base", () => {
    expect(pickShown(meta(true), "qm", "all", all)).toMatchObject({ snap: { patch: "old" }, previous: null, fallback: true });
  });

  it("thin but no previous patch: the current one", () => {
    expect(pickShown(meta(true, null), "qm", "all", all)).toMatchObject({ snap: { patch: "new" }, previous: null, fallback: false });
  });

  it("a previous bracket file from an older bracket definition is never shown under the new label: current patch instead", () => {
    const read = files({ "current/sl_low": snap("new", [1, 2, 3, 4]), "previous/sl_low": snap("old", [1, 2]) });
    expect(pickShown(meta(true), "sl", "low", read)).toMatchObject({ snap: { patch: "new" }, previous: null, fallback: false });
    expect(pickShown(meta(false), "sl", "low", read)).toMatchObject({ snap: { patch: "new" }, previous: null }); // and no ▲▼ against it
  });

  it("nothing valid to show: null", () => {
    expect(pickShown(meta(false), "sl", "high", files({ "current/sl_high": snap("new", [5]) }))).toBeNull();
  });
});
