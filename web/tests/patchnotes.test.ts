import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { HotfixesFile, PatchNotesFile } from "../src/data";
import { PATCH_NOTES_SHOWN, heroPatchNotes } from "../src/lib/patchnotes";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "e2e-data");
// the collector's output for the 2026-09-29, 2026-07-21 and 2026-05-12 official notes
const file = JSON.parse(readFileSync(join(dataDir, "patchnotes.json"), "utf-8")) as PatchNotesFile;
const REF = "2.55.17.98025";
// tools/hotfix_diff.py output for 2.55.17.97650, 97771 (both unannounced) and 98025 (no hero data)
const hotfixes = JSON.parse(readFileSync(join(dataDir, "hotfixes.json"), "utf-8")) as HotfixesFile;

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

  it("an unannounced hotfix sits between the notes by date, as the talent and its numbers old → new", () => {
    const v = heroPatchNotes(file, "Chromie", REF, "ko", hotfixes);
    // Chromie is in the 2026-07-21 note, not in the 2026-09-29 one
    expect(v.notes.map((n) => [n.kind, n.id])).toEqual([
      ["hotfix", "2.55.17.97771"],
      ["hotfix", "2.55.17.97650"],
      ["note", "24291432"],
    ]);
    const h = v.notes[1]!;
    expect(h).toMatchObject({ title: "2.55.17.97650", url: null, verdict: null, published: "2026-07-24T17:21:04Z" });
    expect(h.groups).toEqual([
      { section: "talents", level: null, ability: "만성적인 현상", changes: [
        { text: "0.2 → 0.25", direction: "neutral" },
        { text: "−0.2 → −0.25", direction: "neutral" },
      ] },
      { section: "talents", level: null, ability: "다시 처음으로", changes: [{ text: "−0.55 → −0.5", direction: "neutral" }] },
    ]);
  });

  it("a regular patch (x.y.z) includes every build of it: none of its notes or hotfixes is collecting", () => {
    // owner 2026-10-01: the reference patch is a regular patch with its hotfixes
    expect(heroPatchNotes(file, "Abathur", "2.57.0", "ko").notes.map((n) => n.status)).toEqual(["current", null]);
    expect(heroPatchNotes(file, "Abathur", "2.55.17", "ko").notes.map((n) => n.status)).toEqual(["collecting", "current"]);
    expect(heroPatchNotes(file, "Chromie", "2.55.17", "ko", hotfixes).notes.map((n) => n.status)).toEqual(["current", null, null]);
  });

  it("a hotfix is marked against the reference patch like a note", () => {
    // 97771 is Chromie's newest change the 98025 stats include
    expect(heroPatchNotes(file, "Chromie", REF, "ko", hotfixes).notes.map((n) => n.status)).toEqual(["current", null, null]);
    // per hero: Chen's newest change in the stats is 97650, although Chromie's 97771 is newer
    expect(heroPatchNotes(file, "Chen", REF, "ko", hotfixes).notes.map((n) => [n.kind, n.status])[0]).toEqual(["hotfix", "current"]);
  });

  it("another hero's hotfix or a build with no hero changes (98025) takes no mark from the notes", () => {
    expect(heroPatchNotes(file, "Abathur", REF, "ko", hotfixes).notes.map((n) => n.status)).toEqual(["collecting", "current"]);
  });

  it("English pages name the talent in English; a hero no hotfix touched sees only notes", () => {
    const en = heroPatchNotes(file, "Chen", REF, "en", hotfixes).notes.find((n) => n.kind === "hotfix")!;
    expect(en.groups[0]!.ability).toBe("A Touch of Honey");
    expect(heroPatchNotes(file, "Abathur", REF, "ko", hotfixes).notes.map((n) => n.kind)).toEqual(["note", "note"]);
  });

  it("a build an official note belongs to is shown once, as the note", () => {
    // the watcher records every new build; 2.55.17.97605 is the 2026-07-21 note's build
    const withNoted: HotfixesFile = JSON.parse(JSON.stringify(hotfixes));
    withNoted.builds.push({ build: "2.55.17.97605", previous: "2.55.16.97039", first_seen: "2026-07-20T17:08:51Z", parser: 1, heroes: { Abathur: [{ kind: "talent", id: "X", ko: "무언가", en: "Something", changes: [{ old: "1", new: "2" }] }] } });
    expect(heroPatchNotes(file, "Abathur", REF, "ko", withNoted).notes.map((n) => n.kind)).toEqual(["note", "note"]);
  });

  it("base stats read as the game's word and the numbers; an ability carries its hotkey (parser 3)", () => {
    const one: HotfixesFile = { builds: [{ build: "2.57.0.99999", previous: "2.57.0.98304", first_seen: "2026-10-01T00:00:00Z", parser: 3, heroes: {
      "Mal'Ganis": [
        { kind: "base", id: "base", ko: null, en: null, changes: [{ old: "2600", new: "2700", label: { ko: "생명력", en: "Health" } }] },
        { kind: "ability", id: "MalGanisNightRush", ko: "밤의 질주", en: "Night Rush", key: "E", changes: [{ old: "0.75", new: "0.625" }] },
        { kind: "talent", id: "MalGanisNightRushSpreadingPlague", ko: "퍼져나가는 역병", en: "Spreading Plague", changes: [{ old: "0.1", new: "0.15" }] },
      ],
    } }] };
    const h = heroPatchNotes(null, "Mal'Ganis", REF, "ko", one).notes[0]!;
    expect(h.groups).toEqual([
      { section: "base", level: null, ability: null, changes: [{ text: "생명력 2600 → 2700", direction: "neutral" }] },
      { section: "base", level: null, ability: "밤의 질주 [E]", changes: [{ text: "0.75 → 0.625", direction: "neutral" }] },
      { section: "talents", level: null, ability: "퍼져나가는 역병", changes: [{ text: "0.1 → 0.15", direction: "neutral" }] },
    ]);
    const en = heroPatchNotes(null, "Mal'Ganis", REF, "en", one).notes[0]!;
    expect(en.groups[0]!.changes[0]!.text).toBe("Health 2600 → 2700");
    expect(en.groups[1]!.ability).toBe("Night Rush [E]");
  });
});
