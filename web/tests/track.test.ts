import { afterEach, describe, expect, it, vi } from "vitest";
import { track } from "../src/lib/track";

// Funnel events for GoatCounter (owner 2026-10-03: 31 % of searches found nobody — do they upload?). Names only;
// never a BattleTag or anything about the visitor.

type G = { count: (v: Record<string, unknown>) => void };
const w = globalThis as unknown as { window?: { goatcounter?: G } };

afterEach(() => {
  delete w.window;
});

describe("track", () => {
  it("sends a named event to GoatCounter", () => {
    const count = vi.fn();
    w.window = { goatcounter: { count } };
    track("upload-cta");
    expect(count).toHaveBeenCalledWith({ path: "upload-cta", title: "upload-cta", event: true });
  });

  it("does nothing when GoatCounter is not loaded (blocked, or not yet)", () => {
    w.window = {};
    expect(() => track("upload-cta")).not.toThrow();
    delete w.window;
    expect(() => track("upload-cta")).not.toThrow();
  });

  it("never breaks the page when GoatCounter throws", () => {
    w.window = { goatcounter: { count: () => { throw new Error("x"); } } };
    expect(() => track("upload-complete")).not.toThrow();
  });
});
