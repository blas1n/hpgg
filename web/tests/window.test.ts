import { describe, expect, it } from "vitest";
import { windowNote } from "../src/lib/window";

// owner 2026-10-07: Xal'atath read 70 % here and 56 % after the 10/5 hotfix on Heroes Profile — a patch summed with its
// hotfixes kept her earlier games. A settled balance hotfix now starts the count (collector/snapshot.py balance_window);
// the tier page says which games it counts.

const base = { current_patch: "2.57.0" };

describe("windowNote", () => {
  it("counts from a settled hotfix: names its day (KST)", () => {
    const n = windowNote({ ...base, window: { since: "2.57.0.98348", since_at: "2026-10-05T17:12:19Z", pending: null } });
    expect(n).toEqual({ kind: "since", day: "10/6", build: "2.57.0.98348" });
  });

  it("a hotfix still settling is said: the whole patch counts meanwhile", () => {
    const n = windowNote({ ...base, window: { since: null, since_at: null, pending: { build: "2.57.0.98348", first_seen: "2026-10-05T17:12:19Z" } } });
    expect(n).toEqual({ kind: "pending", day: "10/6", build: "2.57.0.98348" });
  });

  it("no hotfix, or meta from before, says nothing", () => {
    expect(windowNote({ ...base, window: { since: null, since_at: null, pending: null } })).toBeNull();
    expect(windowNote(base)).toBeNull();
  });
});
