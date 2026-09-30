/** The hero page's patch changes (#62): the hero's entries in Blizzard's official notes, in the page language.
 *  Pure: computed at build time from data/patchnotes.json. */
import type { HotfixesFile, PatchDirection, PatchNotesFile, PatchVerdict } from "../data";
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

// hotfix numbers as the game data has them, with a typographic minus
const num = (v: string) => v.replace(/^-/, "\u2212");

type Item = { at: string; build: string | null; view: () => PatchNoteView | null };

export function heroPatchNotes(
  file: PatchNotesFile | null,
  hero: string,
  reference: string,
  locale: Locale,
  hotfixes: HotfixesFile | null = null,
): HeroPatchNotes {
  if (!file && !hotfixes) return { notes: [], since: null };
  const text = (v: { ko: string | null; en: string | null }) => (locale === "ko" ? v.ko : v.en);
  const items: Item[] = [];
  for (const n of file?.notes ?? []) {
    items.push({
      at: n.published,
      build: n.build,
      view: () => {
        const entry = n.heroes[hero];
        if (!entry) return null;
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
        return { kind: "note", id: n.id, published: n.published, title: n.title[locale], url: n.url[locale], status: null, verdict: entry.verdict, groups };
      },
    });
  }
  // a build that changed no hero's numbers (98025, cosmetic) is on no page and takes no mark
  for (const h of (hotfixes?.builds ?? []).filter((b) => Object.keys(b.heroes).length > 0)) {
    items.push({
      at: h.first_seen,
      build: h.build,
      view: () => {
        const groups = (h.heroes[hero] ?? []).flatMap((t) => {
          const name = text(t);
          return name
            ? [{ section: "talents" as const, level: null, ability: name, changes: t.changes.map((c) => ({ text: `${num(c.old)} → ${num(c.new)}`, direction: "neutral" as const })) }]
            : [];
        });
        return groups.length ? { kind: "hotfix", id: h.build, published: h.first_seen, title: h.build, url: null, status: null, verdict: null, groups } : null;
      },
    });
  }
  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  let currentTaken = false;
  const statusOf = (build: string | null): PatchStatus => {
    if (!build) return null;
    if (newer(build, reference)) return "collecting";
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
