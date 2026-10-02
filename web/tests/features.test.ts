import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FEATURES, navIds, sectionEnabled } from "../src/features";
import { pruneDisabled } from "../scripts/prune-features";
import { LOCALES } from "../src/i18n/locales";

// Features switched off for the live site (owner 2026-10-02: 밴픽 only sorts by score with a matchup correction and
// ignores the roles a team needs — off until it is better). A switched-off section is not in the menu, not in the
// sitemap and not in the export (GitHub Pages then answers 404); `next dev` still serves it, to work on it.

describe("features", () => {
  it("밴픽 is off on the live site (owner 2026-10-02)", () => {
    expect(FEATURES.draft).toBe(false);
    expect(sectionEnabled("draft")).toBe(false);
  });

  it("a section without a feature is always on", () => {
    for (const s of ["tier", "heroes", "maps", "players"]) expect(sectionEnabled(s)).toBe(true);
  });

  it("the menu leaves out a switched-off section and keeps the order", () => {
    expect(navIds({ draft: false })).toEqual(["home", "tier", "heroes", "maps", "players"]);
    expect(navIds({ draft: true })).toEqual(["home", "tier", "heroes", "draft", "maps", "players"]);
  });

  it("the export loses a switched-off section in every language and keeps the rest", () => {
    const dist = mkdtempSync(join(tmpdir(), "prune-"));
    try {
      for (const l of LOCALES) {
        for (const s of ["draft", "tier"]) {
          mkdirSync(join(dist, l, "hots", s), { recursive: true });
          writeFileSync(join(dist, l, "hots", s, "index.html"), "x");
        }
      }
      const removed = pruneDisabled(dist, { draft: false });
      expect(removed.sort()).toEqual(LOCALES.map((l) => `${l}/hots/draft`).sort());
      for (const l of LOCALES) {
        expect(existsSync(join(dist, l, "hots", "draft"))).toBe(false);
        expect(existsSync(join(dist, l, "hots", "tier", "index.html"))).toBe(true);
      }
      expect(pruneDisabled(dist, { draft: true })).toEqual([]);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
});
