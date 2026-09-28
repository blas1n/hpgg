import { describe, expect, it } from "vitest";
import { sameCohort } from "../src/lib/cohort";

describe("sameCohort", () => {
  it("is true when both snapshots cover the same league tiers (order-insensitive) or both cover everyone", () => {
    expect(sameCohort({ league_tier: [1, 2, 3] }, { league_tier: [3, 2, 1] })).toBe(true);
    expect(sameCohort({ league_tier: null }, { league_tier: null })).toBe(true);
  });

  it("is false when the bracket definition changed between patches (e.g. 1-2 → 1-3)", () => {
    expect(sameCohort({ league_tier: [1, 2, 3] }, { league_tier: [1, 2] })).toBe(false);
    expect(sameCohort({ league_tier: [6] }, { league_tier: null })).toBe(false);
  });
});
