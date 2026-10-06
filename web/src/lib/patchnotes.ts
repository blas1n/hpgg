/** The hero page's patch changes (#62): the hero's entries in Blizzard's official notes, in the page language.
 *  Pure: computed at build time from data/patchnotes.json. */
import type { Hotfix, HotfixesFile, HotfixItem, NoteHotfix, PatchDirection, PatchGroup, PatchNote, PatchNotesFile, PatchVerdict } from "../data";
import type { Locale } from "../i18n/locale";
import { messages } from "../i18n/messages";

export const PATCH_NOTES_SHOWN = 3;

/** current = the hero's newest change the stats include; collecting = newer than the reference patch. */
export type PatchStatus = "current" | "collecting" | null;

export interface PatchNoteView {
  /** note = an official note; hotfix = a build shipped without one (title = the build) */
  kind: "note" | "hotfix";
  /** a hotfix section Blizzard added to the note: its date (title and link are the note's) */
  hotfix: string | null;
  /** Blizzard has not written it in the page language yet: `groups` are the build's numbers, this is Blizzard's
   *  text in the language it has (shown folded) */
  original: ChangeGroup[] | null;
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
const inUnit = (v: string, unit: "s" | "%" | "x" | undefined, locale: Locale) =>
  unit === "x" ? `×${num(v)}` : unit === "s" ? messages[locale].hero.hotfixSeconds(num(v)) : `${num(v)}${unit ?? ""}`;

const pick = (locale: Locale, v: { ko: string | null; en: string | null }) => (locale === "ko" ? v.ko : v.en);
const pickOrOther = (locale: Locale, v: { ko: string | null; en: string | null }) => pick(locale, v) ?? (locale === "ko" ? v.en : v.ko);

/** An official note's groups for one hero, in the page language; lines without text in that language are left out —
 *  or, for a hotfix section Blizzard has not translated yet (`untranslated`), shown in the language it has. */
export function noteGroups(groups: PatchGroup[], locale: Locale, untranslated = false): ChangeGroup[] {
  const text = untranslated ? pickOrOther : pick;
  return groups
    .map((g) => ({
      section: g.section,
      level: g.level,
      ability: g.ability ? text(locale, g.ability) : null,
      changes: g.changes.flatMap((c) => {
        const t = text(locale, c);
        return t ? [{ text: t, direction: c.direction }] : [];
      }),
    }))
    .filter((g) => g.changes.length > 0);
}

/** A hotfix build's items for one hero: the game data's numbers, old → new; ▲▼ only where the collector named the
 *  stat (parser 5), a bare number stays neutral. */
export function hotfixGroups(items: HotfixItem[], locale: Locale): ChangeGroup[] {
  return items.flatMap((t) => {
    const name = t.kind === "base" ? null : pick(locale, t);
    if (t.kind !== "base" && !name) return [];
    const changes = t.changes.map((c) => ({
      text: `${c.label ? `${c.label[locale]} ` : ""}${inUnit(c.old, c.unit, locale)} → ${inUnit(c.new, c.unit, locale)}`,
      direction: c.direction ?? ("neutral" as const),
    }));
    const ability = name && t.key ? `${name} [${t.key}]` : name;
    return [{ section: t.kind === "talent" ? ("talents" as const) : ("base" as const), level: null, ability, changes }];
  });
}

/** A hotfix section Blizzard added to a note, and the build that shipped it (null until the watcher has seen one). */
export interface AnnouncedHotfix {
  note: PatchNote;
  fix: NoteHotfix;
  build: string | null;
}

// Blizzard heads a hotfix with its US date (10/5); the build that shipped it is the note's patch's build first seen
// nearest that day's US noon, within a day and a half (98348: 10-05 17:12Z for "Hotfix - 10/5/2026")
const HOTFIX_WINDOW_MS = 36 * 3600 * 1000;
const usNoon = (date: string) => Date.parse(`${date}T19:00:00Z`);
const patchOf = (build: string) => build.split(".").slice(0, 3).join(".");

export function announcedHotfixes(notes: PatchNote[], hotfixes: HotfixesFile | null): AnnouncedHotfix[] {
  const out: AnnouncedHotfix[] = [];
  for (const note of notes) {
    for (const fix of note.hotfixes ?? []) {
      if (Object.keys(fix.heroes).length === 0) continue;
      const at = usNoon(fix.date);
      const off = (b: Hotfix) => Math.abs(Date.parse(b.first_seen) - at);
      const near = note.build
        ? (hotfixes?.builds ?? [])
            .filter((b) => patchOf(b.build) === patchOf(note.build!) && newer(b.build, note.build!) && off(b) <= HOTFIX_WINDOW_MS)
            .sort((a, b) => off(a) - off(b))
        : [];
      out.push({ note, fix, build: near[0]?.build ?? null });
    }
  }
  return out;
}

/** One hero's lines of an announced hotfix. Until Blizzard writes it in the page language (owner 10-06: Korean pages
 *  showed English), the build's numbers in that language, Blizzard's own text kept as `original`; without numbers to
 *  show, Blizzard's text stands in. */
export function announcedGroups(a: AnnouncedHotfix, hero: string, locale: Locale, hotfixes: HotfixesFile | null): { groups: ChangeGroup[]; original: ChangeGroup[] | null } {
  const entry = a.fix.heroes[hero];
  if (!entry) return { groups: [], original: null };
  const translated = entry.groups.every((g) => g.changes.every((c) => pick(locale, c) !== null));
  const numbers = translated ? [] : hotfixGroups(hotfixes?.builds.find((b) => b.build === a.build)?.heroes[hero] ?? [], locale);
  return numbers.length ? { groups: numbers, original: noteGroups(entry.groups, locale, true) } : { groups: noteGroups(entry.groups, locale, true), original: null };
}

/** A hotfix build's heroes that no hotfix section of a note names: what is still unannounced in it. */
export function unannounced(build: Hotfix, announced: AnnouncedHotfix[]): Record<string, HotfixItem[]> {
  const named = new Set(announced.filter((a) => a.build === build.build).flatMap((a) => Object.keys(a.fix.heroes)));
  return Object.fromEntries(Object.entries(build.heroes).filter(([hero]) => !named.has(hero)));
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
        return { kind: "note", hotfix: null, original: null, id: n.id, published: n.published, title: n.title[locale], url: n.url[locale], status: null, verdict: entry.verdict, groups };
      },
    });
  }
  // a build that changed no hero's numbers (98025, cosmetic) is on no page and takes no mark;
  // a build an official note belongs to is shown as the note
  // a hotfix Blizzard added to a note is shown with the note's words, the build that shipped it as its place in time
  const announced = announcedHotfixes(file?.notes ?? [], hotfixes);
  const firstSeen = new Map((hotfixes?.builds ?? []).map((b) => [b.build, b.first_seen]));
  for (const a of announced) {
    const { note, fix, build } = a;
    const at = (build && firstSeen.get(build)) || `${fix.date}T19:00:00Z`;
    items.push({
      at,
      build,
      view: () => {
        const entry = fix.heroes[hero];
        if (!entry) return null;
        const { groups, original } = announcedGroups(a, hero, locale, hotfixes);
        return { kind: "note", hotfix: fix.date, original, id: `${note.id}#${fix.date}`, published: at, title: note.title[locale], url: note.url[locale], status: null, verdict: entry.verdict, groups };
      },
    });
  }
  const noted = new Set((file?.notes ?? []).map((n) => n.build));
  for (const b of (hotfixes?.builds ?? []).filter((b) => Object.keys(b.heroes).length > 0 && !noted.has(b.build))) {
    const h = { ...b, heroes: unannounced(b, announced) };
    items.push({
      at: h.first_seen,
      build: h.build,
      view: () => {
        const groups = hotfixGroups(h.heroes[hero] ?? [], locale);
        return groups.length ? { kind: "hotfix", hotfix: null, original: null, id: h.build, published: h.first_seen, title: h.build, url: null, status: null, verdict: null, groups } : null;
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
