import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { PatchNotesFile } from "../src/data";
import { PATCH_NOTES_SHOWN, heroPatchNotes } from "../src/lib/patchnotes";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "e2e-data");
// the collector's output for the 2026-09-29, 2026-07-21 and 2026-05-12 official notes
const file = JSON.parse(readFileSync(join(dataDir, "patchnotes.json"), "utf-8")) as PatchNotesFile;
const REF = "2.55.17.98025";

describe("heroPatchNotes", () => {
  it("the hero's notes, newest first, with the official title, link and date", () => {
    const v = heroPatchNotes(file, "Abathur", REF, "ko");
    expect(v.notes.map((n) => n.id)).toEqual(["24303007", "24291432"]);
    expect(v.notes[0]!.title).toMatch(/^히어로즈 오브 더 스톰 라이브 패치 노트/);
    expect(v.notes[0]!.url).toBe("https://news.blizzard.com/ko-kr/article/24303007/");
    expect(v.notes[0]!.published).toBe("2026-09-28T19:35:00Z");
  });

  it("marks a note newer than the reference patch as collecting, and the newest one in the stats as current", () => {
    const v = heroPatchNotes(file, "Abathur", REF, "ko");
    expect(v.notes.map((n) => n.status)).toEqual(["collecting", "current"]);
    // once 2.57 is the reference, the September note is the current one and July has no mark
    expect(heroPatchNotes(file, "Abathur", "2.57.0.98304", "ko").notes.map((n) => n.status)).toEqual(["current", null]);
  });

  it("verdict and each line's direction as the collector recorded them", () => {
    const qhira = heroPatchNotes(file, "Qhira", REF, "ko").notes[0]!;
    expect(qhira.verdict).toBe("mixed");
    const g = qhira.groups[0]!;
    expect(g).toMatchObject({ section: "base", level: null, ability: "피의 분노 [W]" });
    expect(g.changes[0]).toEqual({ text: "중첩당 추가 공격력이 0.25%에서 0.2%로 감소했습니다.", direction: "down" });
    expect(heroPatchNotes(file, "Mal'Ganis", REF, "ko").notes[0]!.verdict).toBe("buff");
  });

  it("English pages get Blizzard's English text", () => {
    const g = heroPatchNotes(file, "Qhira", REF, "en").notes[0]!.groups[0]!;
    expect(g.ability).toBe("Blood Rage [W]");
    expect(g.changes[0]!.text).toBe("Damage bonus per stack decreased from 0.25% to 0.2%.");
  });

  it("a line without text in the page language is left out, and a group left empty goes with it", () => {
    const one: PatchNotesFile = JSON.parse(JSON.stringify(file));
    const q = one.notes[0]!.heroes["Qhira"]!;
    q.groups[0]!.changes = q.groups[0]!.changes.map((c) => ({ ...c, en: null }));
    const en = heroPatchNotes(one, "Qhira", REF, "en").notes[0]!;
    expect(en.groups.map((g) => g.ability)).not.toContain("Blood Rage [W]");
    expect(heroPatchNotes(one, "Qhira", REF, "ko").notes[0]!.groups[0]!.ability).toBe("피의 분노 [W]");
  });

  it(`at most ${PATCH_NOTES_SHOWN} notes; a hero in none of them has an empty list and the oldest note's date`, () => {
    expect(heroPatchNotes(file, "Abathur", REF, "ko").notes.length).toBeLessThanOrEqual(PATCH_NOTES_SHOWN);
    const none = heroPatchNotes(file, "Nova", REF, "ko");
    expect(none.notes).toEqual([]);
    expect(none.since).toBe("2026-05-11T17:00:00Z");
    expect(heroPatchNotes(null, "Nova", REF, "ko")).toEqual({ notes: [], since: null });
  });

  it("a note whose build is not known yet has no mark", () => {
    const one: PatchNotesFile = JSON.parse(JSON.stringify(file));
    one.notes[0]!.build = null;
    expect(heroPatchNotes(one, "Abathur", REF, "ko").notes[0]!.status).toBeNull();
  });
});
