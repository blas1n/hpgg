/** The hero page's patch changes (#62): the hero's entries in Blizzard's official notes, in the page language.
 *  Pure: computed at build time from data/patchnotes.json. */
import type { HotfixesFile, HotfixItem, PatchDirection, PatchGroup, PatchNotesFile, PatchVerdict } from "../data";
import type { Locale } from "../i18n/locale";

export const PATCH_NOTES_SHOWN = 3;

/** current = the hero's newest change the stats include; collecting = newer than the reference patch. */
export type PatchStatus = "current" | "collecting" | null;

export interface PatchNoteView {
  /** note = an official note; hotfix = a build shipped without one (title = the build) */
  kind: "note" | "hotfix";
  id: string;
  published: string;
  title: string;
  url: string | null;
  status: PatchStatus;
  verdict: PatchVerdict | null;
  groups: ChangeGroup[];
}

/** Changed lines under one heading (section · level · ability), in the page language. */
export interface ChangeGroup {
  section: "base" | "talents";
  level: number | null;
  ability: string | null;
  changes: { text: string; direction: PatchDirection }[];
}

export interface HeroPatchNotes {
  notes: PatchNoteView[];
  /** publish date of the oldest note looked at: "no change since" when notes is empty */
  since: string | null;
}

const key = (v: string) => v.split(".").map(Number);
const newer = (a: string, b: string) => {
  const [x, y] = [key(a), key(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

// hotfix numbers as the game data has them, with a typographic minus
const num = (v: string) => v.replace(/^-/, "\u2212");

const pick = (locale: Locale, v: { ko: string | null; en: string | null }) => (locale === "ko" ? v.ko : v.en);

/** An official note's groups for one hero, in the page language; lines without text in that language are left out. */
export function noteGroups(groups: PatchGroup[], locale: Locale): ChangeGroup[] {
  return groups
    .map((g) => ({
      section: g.section,
      level: g.level,
      ability: g.ability ? pick(locale, g.ability) : null,
      changes: g.changes.flatMap((c) => {
        const t = pick(locale, c);
        return t ? [{ text: t, direction: c.direction }] : [];
      }),
    }))
    .filter((g) => g.changes.length > 0);
}

/** A hotfix build's items for one hero: the game data's numbers, old → new (no direction is judged). */
export function hotfixGroups(items: HotfixItem[], locale: Locale): ChangeGroup[] {
  return items.flatMap((t) => {
    const name = t.kind === "base" ? null : pick(locale, t);
    if (t.kind !== "base" && !name) return [];
    const changes = t.changes.map((c) => ({
      text: `${c.label ? `${c.label[locale]} ` : ""}${num(c.old)} → ${num(c.new)}`,
      direction: "neutral" as const,
    }));
    const ability = name && t.key ? `${name} [${t.key}]` : name;
    return [{ section: t.kind === "talent" ? ("talents" as const) : ("base" as const), level: null, ability, changes }];
  });
}

type Item = { at: string; build: string | null; view: () => PatchNoteView | null };

export function heroPatchNotes(
  file: PatchNotesFile | null,
  hero: string,
  reference: string,
  locale: Locale,
  hotfixes: HotfixesFile | null = null,
): HeroPatchNotes {
  if (!file && !hotfixes) return { notes: [], since: null };
  const items: Item[] = [];
  for (const n of file?.notes ?? []) {
    items.push({
      at: n.published,
      build: n.build,
      view: () => {
        const entry = n.heroes[hero];
        if (!entry) return null;
        const groups = noteGroups(entry.groups, locale);
        return { kind: "note", id: n.id, published: n.published, title: n.title[locale], url: n.url[locale], status: null, verdict: entry.verdict, groups };
      },
    });
  }
  // a build that changed no hero's numbers (98025, cosmetic) is on no page and takes no mark;
  // a build an official note belongs to is shown as the note
  const noted = new Set((file?.notes ?? []).map((n) => n.build));
  for (const h of (hotfixes?.builds ?? []).filter((b) => Object.keys(b.heroes).length > 0 && !noted.has(b.build))) {
    items.push({
      at: h.first_seen,
      build: h.build,
      view: () => {
        const groups = hotfixGroups(h.heroes[hero] ?? [], locale);
        return groups.length ? { kind: "hotfix", id: h.build, published: h.first_seen, title: h.build, url: null, status: null, verdict: null, groups } : null;
      },
    });
  }
  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  let currentTaken = false;
  const statusOf = (build: string | null): PatchStatus => {
    if (!build) return null;
    // a regular patch (x.y.z) holds every build of it: compare the build at the reference's depth
    if (newer(build.split(".").slice(0, reference.split(".").length).join("."), reference)) return "collecting";
    if (currentTaken) return null;
    currentTaken = true;
    return "current";
  };
  const notes: PatchNoteView[] = [];
  for (const it of items) {
    if (notes.length >= PATCH_NOTES_SHOWN) break;
    const v = it.view();
    // "current" = this hero's newest change the stats include; a hotfix makes that per hero
    if (v) notes.push({ ...v, status: statusOf(it.build) });
  }
  return { notes, since: file?.notes.at(-1)?.published ?? null };
}
