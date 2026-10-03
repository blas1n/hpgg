/** 패치 요약 (owner 2026-10-03, from community feedback: patch notes are long — show buff/nerf at a glance): what the
 *  reference patch changed — official notes, hotfixes shipped without one, new heroes — and where each changed hero
 *  stands now against the previous patch, by the tier formula. Numbers only; nothing is said about cause.
 *  Pure: computed at build time; one page for both modes. */
import { computeTiers, type Snapshot } from "../formula";
import type { HeroTable, HotfixesFile, Mode, PatchNotesFile, PatchVerdict } from "../data";
import type { Locale } from "../i18n/locale";
import type { HeroRef } from "./home";

/** One mode's rank and win rate on the previous patch → this one (tier formula on each). */
export interface PatchImpact {
  prevRank: number | null;
  rank: number | null;
  /** previous rank − rank (positive = climbed); null when either side is unranked */
  delta: number | null;
  prevWr: number | null;
  wr: number | null;
}

export interface PatchHeroRow {
  hero: HeroRef;
  /** from the patch's official notes; several notes that disagree are 조정 (mixed); null = no note named the hero */
  verdict: PatchVerdict | null;
  /** changed by a build of the patch that has no note */
  hotfix: boolean;
  /** stats on this patch and none on the previous one */
  isNew: boolean;
  /** the change is the same in every mode; only the ranks differ (owner 10-03: one page, modes side by side) */
  qm: PatchImpact | null;
  sl: PatchImpact | null;
}

type ByMode<T> = Record<Mode, T>;

export interface PatchSummary {
  patch: string;
  previousPatch: string | null;
  /** the patch's official notes, newest first */
  notes: { id: string; title: string; url: string; published: string }[];
  /** builds of the patch shipped without a note that changed a hero, newest first */
  hotfixBuilds: string[];
  counts: { buff: number; nerf: number; mixed: number; hotfix: number; new: number };
  /** new heroes first, then the biggest Quick Match climb to the biggest fall (the larger sample, the site's default) */
  rows: PatchHeroRow[];
  up: ByMode<PatchHeroRow | null>;
  down: ByMode<PatchHeroRow | null>;
}

export interface PatchSummaryInput {
  patch: string;
  notes: PatchNotesFile | null;
  hotfixes: HotfixesFile | null;
  /** each mode's snapshot on the patch and on the previous one (null before the first patch change) */
  modes: ByMode<{ snap: Snapshot; previous: Snapshot | null }>;
  heroes: HeroTable;
  minGames: number;
  locale: Locale;
}

const MODES: Mode[] = ["qm", "sl"];

/** A build of a regular patch x.y.z is x.y.z.<build>; data from before x.y.z patches names a patch by one build. */
const inPatch = (build: string | null, patch: string): boolean => !!build && (build === patch || build.startsWith(`${patch}.`));

export function patchSummary({ patch, notes, hotfixes, modes, heroes, minGames, locale }: PatchSummaryInput): PatchSummary {
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
  const rankOf = (s: Snapshot | null) => new Map(s ? computeTiers(all(s), minGames).ranked.map((x) => [x.row.hero, x.rank]) : []);
  const wrOf = (s: Snapshot | null) => new Map(s ? all(s).map((r) => [r.hero, r.win_rate]) : []);
  const tables = Object.fromEntries(
    MODES.map((m) => [m, { rank: rankOf(modes[m].snap), wr: wrOf(modes[m].snap), prevRank: rankOf(modes[m].previous), prevWr: wrOf(modes[m].previous), hasPrevious: !!modes[m].previous }]),
  ) as ByMode<{ rank: Map<string, number>; wr: Map<string, number>; prevRank: Map<string, number>; prevWr: Map<string, number>; hasPrevious: boolean }>;
  const impact = (m: Mode, name: string): PatchImpact | null => {
    const t = tables[m];
    if (!t.wr.has(name) && !t.prevWr.has(name)) return null;
    const r = t.rank.get(name) ?? null;
    const p = t.prevRank.get(name) ?? null;
    return { prevRank: p, rank: r, delta: r !== null && p !== null ? p - r : null, prevWr: t.prevWr.get(name) ?? null, wr: t.wr.get(name) ?? null };
  };
  // new: stats on this patch and none on the previous one, in a mode that has a previous patch
  const isNew = (name: string) => MODES.some((m) => tables[m].hasPrevious && tables[m].wr.has(name) && !tables[m].prevWr.has(name));

  const names = new Set([...verdict.keys(), ...hotfixed, ...MODES.flatMap((m) => [...tables[m].wr.keys()].filter(isNew))]);
  const rows: PatchHeroRow[] = [...names].flatMap((name) => {
    const hero = refs.get(name);
    return hero ? [{ hero, verdict: verdict.get(name) ?? null, hotfix: hotfixed.has(name), isNew: isNew(name), qm: impact("qm", name), sl: impact("sl", name) }] : [];
  });
  const d = (r: PatchHeroRow, m: Mode) => r[m]?.delta ?? -Infinity;
  rows.sort((a, b) => Number(b.isNew) - Number(a.isNew) || d(b, "qm") - d(a, "qm") || d(b, "sl") - d(a, "sl") || a.hero.ko.localeCompare(b.hero.ko, locale));

  const extreme = (m: Mode, sign: 1 | -1) =>
    rows.filter((r) => (r[m]?.delta ?? 0) * sign > 0).sort((a, b) => (b[m]!.delta! - a[m]!.delta!) * sign)[0] ?? null;
  const count = (v: PatchVerdict) => rows.filter((r) => r.verdict === v).length;
  const previousPatch = modes.qm.previous?.patch ?? modes.sl.previous?.patch ?? null;
  return {
    patch,
    previousPatch,
    notes: patchNotes.map((n) => ({ id: n.id, title: n.title[locale], url: n.url[locale], published: n.published })),
    hotfixBuilds: hotfixBuilds.map((b) => b.build),
    counts: { buff: count("buff"), nerf: count("nerf"), mixed: count("mixed"), hotfix: rows.filter((r) => r.hotfix).length, new: rows.filter((r) => r.isNew).length },
    rows,
    up: { qm: extreme("qm", 1), sl: extreme("sl", 1) },
    down: { qm: extreme("qm", -1), sl: extreme("sl", -1) },
  };
}
