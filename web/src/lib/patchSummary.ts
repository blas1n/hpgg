/** 패치 요약 (owner 2026-10-03, from community feedback: patch notes are long — show buff/nerf at a glance): what the
 *  reference patch changed — official notes, hotfixes shipped without one, new heroes — and where each changed hero
 *  stands now against the previous patch, by the tier formula. Numbers only; nothing is said about cause.
 *  Pure: computed at build time for each mode. */
import { computeTiers, type Snapshot } from "../formula";
import type { HeroTable, HotfixesFile, PatchNotesFile, PatchVerdict } from "../data";
import type { Locale } from "../i18n/locale";
import type { HeroRef } from "./home";

export interface PatchHeroRow {
  hero: HeroRef;
  /** from the patch's official notes; several notes that disagree are 조정 (mixed); null = no note named the hero */
  verdict: PatchVerdict | null;
  /** changed by a build of the patch that has no note */
  hotfix: boolean;
  /** stats on this patch and none on the previous one */
  isNew: boolean;
  prevRank: number | null;
  rank: number | null;
  /** previous rank − rank (positive = climbed); null when either side is unranked */
  delta: number | null;
  prevWr: number | null;
  wr: number | null;
}

export interface PatchSummary {
  patch: string;
  previousPatch: string | null;
  /** the patch's official notes, newest first */
  notes: { id: string; title: string; url: string; published: string }[];
  /** builds of the patch shipped without a note that changed a hero, newest first */
  hotfixBuilds: string[];
  counts: { buff: number; nerf: number; mixed: number; hotfix: number; new: number };
  /** new heroes first, then the biggest climb to the biggest fall, then the unranked */
  rows: PatchHeroRow[];
  up: PatchHeroRow | null;
  down: PatchHeroRow | null;
}

export interface PatchSummaryInput {
  patch: string;
  previousPatch: string | null;
  notes: PatchNotesFile | null;
  hotfixes: HotfixesFile | null;
  snap: Snapshot;
  previous: Snapshot | null;
  heroes: HeroTable;
  minGames: number;
  locale: Locale;
}

/** A build of a regular patch x.y.z is x.y.z.<build>; data from before x.y.z patches names a patch by one build. */
const inPatch = (build: string | null, patch: string): boolean => !!build && (build === patch || build.startsWith(`${patch}.`));

export function patchSummary({ patch, previousPatch, notes, hotfixes, snap, previous, heroes, minGames, locale }: PatchSummaryInput): PatchSummary {
  const refs = new Map(heroes.heroes.map((h) => [h.name, { slug: h.slug, ko: h.ko, name: h.name, role: h.role, role_ko: h.role_ko, portrait: h.portrait } as HeroRef]));
  const patchNotes = (notes?.notes ?? []).filter((n) => inPatch(n.build, patch));
  const noted = new Set(patchNotes.map((n) => n.build));
  const hotfixBuilds = (hotfixes?.builds ?? []).filter((b) => inPatch(b.build, patch) && !noted.has(b.build) && Object.keys(b.heroes).length > 0);

  const verdict = new Map<string, PatchVerdict>();
  for (const n of patchNotes) {
    for (const [name, entry] of Object.entries(n.heroes)) {
      const had = verdict.get(name);
      verdict.set(name, had && had !== entry.verdict ? "mixed" : entry.verdict);
    }
  }
  const hotfixed = new Set(hotfixBuilds.flatMap((b) => Object.keys(b.heroes)));

  const all = (s: Snapshot) => s.rows.filter((r) => r.map === "all");
  const rankOf = (s: Snapshot) => new Map(computeTiers(all(s), minGames).ranked.map((x) => [x.row.hero, x.rank]));
  const wrOf = (s: Snapshot) => new Map(all(s).map((r) => [r.hero, r.win_rate]));
  const rank = rankOf(snap);
  const wr = wrOf(snap);
  const prevRank = previous ? rankOf(previous) : new Map<string, number>();
  const prevWr = previous ? wrOf(previous) : new Map<string, number>();
  const isNew = (name: string) => !!previous && wr.has(name) && !prevWr.has(name);

  const names = new Set([...verdict.keys(), ...hotfixed, ...[...wr.keys()].filter(isNew)]);
  const rows: PatchHeroRow[] = [...names].flatMap((name) => {
    const hero = refs.get(name);
    if (!hero) return [];
    const r = rank.get(name) ?? null;
    const p = prevRank.get(name) ?? null;
    return [{ hero, verdict: verdict.get(name) ?? null, hotfix: hotfixed.has(name), isNew: isNew(name), prevRank: p, rank: r, delta: r !== null && p !== null ? p - r : null, prevWr: prevWr.get(name) ?? null, wr: wr.get(name) ?? null }];
  });
  rows.sort((a, b) => Number(b.isNew) - Number(a.isNew) || (b.delta ?? -Infinity) - (a.delta ?? -Infinity) || (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.hero.ko.localeCompare(b.hero.ko, locale));

  const moved = rows.filter((r) => r.delta !== null && r.delta !== 0);
  const up = moved.filter((r) => r.delta! > 0).sort((a, b) => b.delta! - a.delta!)[0] ?? null;
  const down = moved.filter((r) => r.delta! < 0).sort((a, b) => a.delta! - b.delta!)[0] ?? null;
  const count = (v: PatchVerdict) => rows.filter((r) => r.verdict === v).length;
  return {
    patch,
    previousPatch: previous ? previousPatch : null,
    notes: patchNotes.map((n) => ({ id: n.id, title: n.title[locale], url: n.url[locale], published: n.published })),
    hotfixBuilds: hotfixBuilds.map((b) => b.build),
    counts: { buff: count("buff"), nerf: count("nerf"), mixed: count("mixed"), hotfix: rows.filter((r) => r.hotfix).length, new: rows.filter((r) => r.isNew).length },
    rows,
    up,
    down,
  };
}
