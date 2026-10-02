import { describe, expect, it } from "vitest";
import { shortDate } from "../src/data";

describe("shortDate", () => {
  // the collector runs at 03:20 KST, which is still the day before in UTC (18:20Z)
  it("is the Korean calendar day of a dawn run", () => {
    expect(shortDate("2026-10-01T18:40:00Z")).toBe("10/02");
  });
  it("is the same day for a daytime run", () => {
    expect(shortDate("2026-10-02T03:04:08Z")).toBe("10/02");
  });
});
