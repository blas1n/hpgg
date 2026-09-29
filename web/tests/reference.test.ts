import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadMatchups, onReference, referencePatchId, type Meta } from "../src/data";

// One reference patch for the whole site (owner 2026-09-29): per-patch files are only shown on it.
const meta = (reference?: string): Meta => ({
  current_patch: "new",
  previous_patch: "old",
  ...(reference ? { reference_patch: reference } : {}),
  patch_started_at: "2026-09-29",
  collected_at: "t",
  min_games_for_tier: 200,
  modes: {},
});

describe("onReference", () => {
  it("the reference patch's build id: meta.reference_patch, else the current patch", () => {
    expect(referencePatchId(meta("old"))).toBe("old");
    expect(referencePatchId(meta("new"))).toBe("new");
    expect(referencePatchId(meta())).toBe("new");
  });

  it("a builds or matchups file is shown only when it is on the reference patch", () => {
    expect(onReference({ patch: "old" }, meta("old"))).toEqual({ patch: "old" });
    expect(onReference({ patch: "new" }, meta("old"))).toBeNull(); // the thin new patch's builds, under an old-patch page
    expect(onReference(null, meta("old"))).toBeNull();
  });
});

describe("loadMatchups (browser, 밴픽)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const serve = (body: object) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));

  it("returns the file on the reference patch and nothing for another patch", async () => {
    serve({ hero: "Abathur", patch: "old", ally: [], enemy: [] });
    expect(await loadMatchups("abathur", "old")).toMatchObject({ patch: "old" });
    expect(await loadMatchups("abathur", "new")).toBeNull();
  });
});

describe("the server readers apply it (build time)", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "server", "data.ts"), "utf-8");
  it("readBuilds and readMatchups go through onReference", () => {
    expect(src).toMatch(/export const readBuilds = [^\n]*onReference\(/);
    expect(src).toMatch(/export const readMatchups = [^\n]*onReference\(/);
  });
});
