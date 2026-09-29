import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Snapshot } from "../src/formula";
import type { HeroTable, MapTable } from "../src/data";
import { knownOnly } from "../src/lib/known";
import { MAP_TOP_N, mapDetail, mapObjective, type MapInfo, type MapsMeta } from "../src/lib/maps";

const here = dirname(fileURLToPath(import.meta.url));
const e2e = <T>(rel: string): T => JSON.parse(readFileSync(join(here, "e2e-data", rel), "utf-8")) as T;
const repo = <T>(rel: string): T => JSON.parse(readFileSync(join(here, "..", "..", "data", rel), "utf-8")) as T;
const heroes = e2e<HeroTable>("heroes_ko.json");
// pages read snapshots through readShown, which drops heroes without assets (lib/known.ts)
const sl = knownOnly(e2e<Snapshot>("latest/sl.json"), heroes);

describe("mapDetail", () => {
  const d = mapDetail(sl, "Cursed Hollow", heroes, 200);

  it("top heroes on the map by win rate, only those over the sample floor", () => {
    expect(d.top.length).toBeGreaterThan(0);
    expect(d.top.length).toBeLessThanOrEqual(MAP_TOP_N);
    expect(d.top.every((t) => t.games >= 200)).toBe(true);
    const wr = d.top.map((t) => t.win_rate);
    expect(wr).toEqual([...wr].sort((a, b) => b - a));
    // the best qualified hero on the map is first
    const best = sl.rows.filter((r) => r.map === "Cursed Hollow" && r.games >= 200).sort((a, b) => b.win_rate - a.win_rate)[0]!;
    expect(d.top[0]!.hero.name).toBe(best.hero);
    expect(d.top[0]!.wrHalf).toBeGreaterThan(0);
  });

  it("each hero carries its tier computed on this map's rows, and the match count is games / 10", () => {
    expect(d.top.every((t) => ["S", "A", "B", "C", "D", "F"].includes(t.tier))).toBe(true);
    const rows = sl.rows.filter((r) => r.map === "Cursed Hollow");
    expect(d.matches).toBe(Math.round(rows.reduce((a, r) => a + r.games, 0) / 10));
    expect(d.qualified).toBe(rows.filter((r) => r.games >= 200).length);
  });

  it("a map without rows in the snapshot has no matches and no heroes", () => {
    expect(mapDetail(sl, "Towers of Doom", heroes, 200)).toMatchObject({ matches: 0, qualified: 0, top: [] });
  });
});

describe("mapObjective", () => {
  const ko = { title: "포로수용소", text: "적의 포로수용소를 공격하면" };
  const en = { title: "Prison Camps", text: "Capture the enemy Prison Camp" };
  const src = (l: string) => ({ title: l, url: `https://web.archive.org/web/1/${l}`, original: l });
  const info: MapInfo = { name: "Alterac Pass", objective: [ko], source: src("ko"), en: { objective: [en], source: src("en") } };

  it("Korean pages show the Korean text, English pages the English text with its own source", () => {
    expect(mapObjective(info, "ko")).toEqual({ steps: [ko], source: src("ko"), fallback: false });
    expect(mapObjective(info, "en")).toEqual({ steps: [en], source: src("en"), fallback: false });
  });

  it("without an English page, the English page falls back to the Korean text and says so", () => {
    for (const noEn of [{ ...info, en: undefined }, { ...info, en: { fallback: "ko" as const } }]) {
      expect(mapObjective(noEn, "en")).toEqual({ steps: [ko], source: src("ko"), fallback: true });
      expect(mapObjective(noEn, "ko").fallback).toBe(false);
    }
  });
});

describe("data/maps_meta.json", () => {
  const meta = repo<MapsMeta>("maps_meta.json");
  const maps = repo<MapTable>("maps_ko.json").maps;

  it("covers exactly the maps in maps_ko.json", () => {
    expect(Object.keys(meta.maps).sort()).toEqual(maps.map((m) => m.slug).sort());
    for (const m of maps) expect(meta.maps[m.slug]!.name).toBe(m.name);
  });

  it("every map has its three official objective steps and cites where they come from", () => {
    for (const [slug, m] of Object.entries(meta.maps)) {
      expect(m.objective, slug).toHaveLength(3);
      for (const s of m.objective) {
        expect(s.title.trim(), slug).not.toBe("");
        expect(s.text.length, slug).toBeGreaterThan(10);
      }
      expect(m.source.url, slug).toMatch(/^https:\/\/web\.archive\.org\/web\/\d{14}\/https:\/\/heroesofthestorm\.com\/ko-kr\/battlegrounds\//);
      expect(m.source.original, slug).toMatch(/^https:\/\/heroesofthestorm\.com\/ko-kr\/battlegrounds\/[a-z-]+\/$/);
      expect(m.source.title, slug).toContain("히어로즈 오브 더 스톰");
    }
    expect(meta._source.objectives).toContain("공식");
  });

  it("every map has the English objective from the same official page's en-us version, cited, three steps", () => {
    for (const [slug, m] of Object.entries(meta.maps)) {
      const en = m.en;
      expect(en, slug).toBeDefined();
      if (!en || !("objective" in en)) continue; // a documented Korean fallback would be allowed; none is needed today
      expect(en.objective, slug).toHaveLength(3);
      for (const s of en.objective) {
        expect(s.title.trim(), slug).not.toBe("");
        expect(s.text.length, slug).toBeGreaterThan(10);
        expect(s.text, slug).not.toMatch(/[\uac00-\ud7a3]/);
      }
      expect(en.source.original, slug).toBe(m.source.original.replace("/ko-kr/", "/en-us/"));
      expect(en.source.url, slug).toMatch(/^https:\/\/web\.archive\.org\/web\/\d{14}\/https:\/\/heroesofthestorm\.com\/en-us\/battlegrounds\//);
      expect(en.source.title, slug).toContain("Heroes of the Storm");
    }
    expect(meta._source.objectives_en).toContain("en-us");
  });

  it("the e2e data set carries the same file", () => {
    expect(e2e<MapsMeta>("maps_meta.json")).toEqual(meta);
  });
});
