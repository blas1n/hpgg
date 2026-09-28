/** Build-time data access (server components only): reads the same files the client fetches, from DATA_DIR. */
import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { computeTiers, PRESETS, type Snapshot } from "../formula";
import type { HeroTable, MapTable, Meta, Mode } from "../data";
import type { SearchItem } from "../lib/search";

const dir = resolve(process.cwd(), process.env.DATA_DIR ?? "../data");
const read = <T>(rel: string): T => JSON.parse(readFileSync(join(dir, rel), "utf-8")) as T;

export const readMeta = (): Meta => read<Meta>("latest/meta.json");
export const readHeroes = (): HeroTable => read<HeroTable>("heroes_ko.json");
export const readMaps = (): MapTable => read<MapTable>("maps_ko.json");
export const readSnapshot = (key: string, patch: "current" | "previous" = "current"): Snapshot | null => {
  const rel = `${patch === "previous" ? "previous" : "latest"}/${key}.json`;
  return existsSync(join(dir, rel)) ? read<Snapshot>(rel) : null;
};

/** Header search index: every hero, sorted by Korean name, with the current Quick Match tier. */
export function readSearchIndex(mode: Mode = "qm"): SearchItem[] {
  const heroes = readHeroes();
  const meta = readMeta();
  const snap = readSnapshot(mode);
  const tiers = snap ? computeTiers(snap.rows.filter((r) => r.map === "all"), PRESETS.aichi, meta.min_games_for_tier) : null;
  const tierOf = new Map(tiers?.ranked.map((x) => [x.row.hero, x.tier]) ?? []);
  return [...heroes.heroes]
    .sort((a, b) => a.ko.localeCompare(b.ko, "ko"))
    .map((h) => ({ slug: h.slug, ko: h.ko, name: h.name, role: h.role, role_ko: h.role_ko, portrait: h.portrait, tier: tierOf.get(h.name) }));
}
