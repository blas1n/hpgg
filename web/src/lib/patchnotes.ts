/** The hero page's patch changes (#62): the hero's entries in Blizzard's official notes, in the page language.
 *  Pure: computed at build time from data/patchnotes.json. */
import type { PatchDirection, PatchNotesFile, PatchVerdict } from "../data";
import type { Locale } from "../i18n/locale";

export const PATCH_NOTES_SHOWN = 3;

/** current = the newest note the stats include; collecting = newer than the reference patch. */
export type PatchStatus = "current" | "collecting" | null;

export interface PatchNoteView {
  id: string;
  published: string;
  title: string;
  url: string;
  status: PatchStatus;
  verdict: PatchVerdict;
  groups: { section: "base" | "talents"; level: number | null; ability: string | null; changes: { text: string; direction: PatchDirection }[] }[];
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

export function heroPatchNotes(file: PatchNotesFile | null, hero: string, reference: string, locale: Locale): HeroPatchNotes {
  if (!file) return { notes: [], since: null };
  const text = (v: { ko: string; en: string | null }) => (locale === "ko" ? v.ko : v.en);
  let currentTaken = false;
  const statusOf = (build: string | null): PatchStatus => {
    if (!build) return null;
    if (newer(build, reference)) return "collecting";
    if (currentTaken) return null;
    currentTaken = true;
    return "current";
  };
  const notes: PatchNoteView[] = [];
  for (const n of file.notes) {
    // the status of every note, the hero's or not: "current" is the newest note the stats include
    const status = statusOf(n.build);
    const entry = n.heroes[hero];
    if (!entry || notes.length >= PATCH_NOTES_SHOWN) continue;
    const groups = entry.groups
      .map((g) => ({
        section: g.section,
        level: g.level,
        ability: g.ability ? text(g.ability) : null,
        changes: g.changes.flatMap((c) => {
          const t = text(c);
          return t ? [{ text: t, direction: c.direction }] : [];
        }),
      }))
      .filter((g) => g.changes.length > 0);
    notes.push({ id: n.id, published: n.published, title: n.title[locale], url: n.url[locale], status, verdict: entry.verdict, groups });
  }
  return { notes, since: file.notes.at(-1)?.published ?? null };
}
