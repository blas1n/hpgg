import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Snapshot } from "../src/formula";
import { regionSample, snapshotKey, thinSample, type HeroTable, type Meta } from "../src/data";
import { messages } from "../src/i18n/messages";
import { sameCohort } from "../src/lib/cohort";
import { regionRows } from "../src/lib/hero";
import { pickShown, regionMatches } from "../src/lib/shown";
import { DEFAULT_TIER_STATE, parseTierState, resolvePatch, tierSearch } from "../src/lib/tier";

const snap = (patch: string, region: string | null = null): Snapshot => ({ patch, mode: "qm", game_type: "qm", league_tier: null, region, collected_at: "2026-09-30T18:30:00Z", matches: 1, rows: [] });
const meta: Meta = {
  current_patch: "new",
  previous_patch: "old",
  patch_started_at: "2026-09-20",
  collected_at: "2026-10-01T18:30:00Z",
  min_games_for_tier: 200,
  modes: {
    qm: { matches: 1, heroes: 90, heroes_over_200: 80 },
    qm_kr: { matches: 1, heroes: 90, heroes_over_200: 60, collected_at: "2026-09-30T18:30:00Z" },
    qm_na: { matches: 1, heroes: 90, heroes_over_200: 12, collected_at: "2026-10-01T18:30:00Z" },
  },
};
const noHeroes: HeroTable = { roles: [], heroes: [] };

describe("region labels and keys", () => {
  it("아시아 (KR) / 아메리카 (NA) / 유럽 (EU); no CN", () => {
    expect(messages.ko.common.regions).toEqual({ all: "전체 지역", kr: "아시아 (KR)", na: "아메리카 (NA)", eu: "유럽 (EU)" });
    expect(messages.en.common.regions).toEqual({ all: "All regions", kr: "Asia (KR)", na: "Americas (NA)", eu: "Europe (EU)" });
  });
  it("region files are {mode}_{region}; a region never combines with a bracket", () => {
    expect(snapshotKey("qm", "all", "kr")).toBe("qm_kr");
    expect(snapshotKey("sl", "all", "eu")).toBe("sl_eu");
    expect(snapshotKey("sl", "low", "all")).toBe("sl_low");
    expect(snapshotKey("sl", "low")).toBe("sl_low");
    expect(() => snapshotKey("sl", "low", "kr")).toThrow();
  });
});

describe("tier URL state", () => {
  it("?region= round-trips; default stays out of the URL", () => {
    const s = { ...DEFAULT_TIER_STATE, mode: "sl" as const, region: "na" as const, map: "Cursed Hollow" };
    expect(tierSearch(s)).toBe("mode=sl&region=na&map=Cursed+Hollow");
    expect(parseTierState(tierSearch(s))).toEqual(s);
    expect(DEFAULT_TIER_STATE.region).toBe("all");
    expect(tierSearch(DEFAULT_TIER_STATE)).toBe("");
  });
  it("QM has regions too; unknown or CN falls back to every region", () => {
    expect(parseTierState("?region=kr").region).toBe("kr");
    expect(parseTierState("?region=cn").region).toBe("all");
    expect(parseTierState("?region=KR").region).toBe("all");
  });
  it("region + bracket is not collected: a region in the URL wins and the bracket is dropped", () => {
    expect(parseTierState("?mode=sl&tier=high&region=eu")).toMatchObject({ region: "eu", bracket: "all" });
  });
});

describe("region files", () => {
  it("a region file is only shown under its own region", () => {
    expect(regionMatches(snap("x", "KR"), "kr")).toBe(true);
    expect(regionMatches(snap("x", "KR"), "na")).toBe(false);
    expect(regionMatches(snap("x", null), "all")).toBe(true);
    expect(regionMatches(snap("x", "KR"), "all")).toBe(false);
    expect(regionMatches({ ...snap("x"), region: undefined }, "all")).toBe(true); // files from before #14
  });
  it("another region is another cohort: no ▲▼ across regions", () => {
    expect(sameCohort(snap("a", "KR"), snap("b", "KR"))).toBe(true);
    expect(sameCohort(snap("a", "KR"), snap("b", null))).toBe(false);
    expect(sameCohort(snap("a", null), { ...snap("b"), region: undefined })).toBe(true);
  });
  it("pickShown reads the region file and never shows a mislabelled one", () => {
    const files: Record<string, Snapshot> = { "current/qm_kr": snap("new", "KR"), "current/qm_na": snap("new", "KR") };
    const read = (key: string, patch: "current" | "previous") => files[`${patch}/${key}`] ?? null;
    expect(pickShown(meta, "qm", "all", read, noHeroes, "kr")).toMatchObject({ snap: { region: "KR" }, previous: null, fallback: false });
    expect(pickShown(meta, "qm", "all", read, noHeroes, "na")).toBeNull();
  });
  it("sample health per region: thin when under half the heroes pass the floor", () => {
    expect(thinSample(meta, "qm_na")).toBe(true);
    expect(thinSample(meta, "qm_kr")).toBe(false);
    expect(regionSample(meta, "qm", "na")).toEqual({ collectedAt: "2026-10-01T18:30:00Z", heroes: 90, over: 12, thin: true });
    expect(regionSample(meta, "qm", "eu")).toBeNull(); // not collected yet
    // a thin region with no previous-patch file of its own stays on the current patch
    expect(resolvePatch(meta, "qm", "auto", "qm_kr").patch).toBe("current");
  });
});

describe("regionRows (hero detail)", () => {
  const dataDir = join(dirname(fileURLToPath(import.meta.url)), "e2e-data");
  const qmKr = JSON.parse(readFileSync(join(dataDir, "latest/qm_kr.json"), "utf-8")) as Snapshot;
  it("one row per collected region with its tier, win rate, games and date", () => {
    const rows = regionRows([{ key: "kr", snap: qmKr }, { key: "na", snap: null }], "Illidan", 200);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "kr", collectedAt: qmKr.collected_at });
    expect(rows[0]!.games).toBeGreaterThan(0);
  });
});
