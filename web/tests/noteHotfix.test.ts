import { describe, expect, it } from "vitest";
import type { HeroTable, HotfixesFile, PatchNotesFile } from "../src/data";
import type { Row, Snapshot } from "../src/formula";
import { heroPatchNotes } from "../src/lib/patchnotes";
import { patchSummary } from "../src/lib/patchSummary";

// Blizzard adds "Hotfix - 10/5/2026" to the top of the 2.57 live note (owner 10-06: "패치노트까지 생긴 정규 패치인데
// 핫픽스로 인식"): the build that shipped it is announced — Blizzard's lines, not the game data's bare numbers.

const notes: PatchNotesFile = {
  parser: 3,
  fetched_at: "2026-10-06T00:00:00Z",
  notes: [
    {
      id: "24303007",
      published: "2026-09-28T19:35:00Z",
      build: "2.57.0.98285",
      title: { ko: "라이브 패치 노트 - 2026년 9월 29일", en: "Live Patch Notes - September 28, 2026" },
      url: { ko: "https://news.blizzard.com/ko-kr/article/24303007/", en: "https://news.blizzard.com/en-us/article/24303007/" },
      heroes: {},
      hotfixes: [
        {
          date: "2026-10-05",
          heroes: {
            "Xal'atath": {
              verdict: "mixed",
              groups: [
                // Korean is not out yet: the English line stands in
                { section: "base", level: null, ability: { ko: null, en: "Void Step [E]" }, changes: [{ ko: null, en: "Targeting range reduced from 5 to 2.", direction: "down" }] },
                { section: "talents", level: 7, ability: { ko: "어린 양의 침묵", en: "Silence of the Lamb" }, changes: [{ ko: "침묵 지속시간이 1초에서 1.5초로 증가했습니다.", en: "Silence duration increased from 1 to 1.5 seconds.", direction: "up" }] },
              ],
            },
          },
        },
      ],
    },
  ],
};

const xalNumbers = [{ kind: "ability" as const, id: "XalatathVoidStep", ko: "공허 걸음", en: "Void Step", key: "E", changes: [{ old: "5", new: "2" }] }];
const hotfixes: HotfixesFile = {
  builds: [
    // the build that shipped the 10/5 hotfix; Whitemane's change is in no note
    { build: "2.57.0.98348", previous: "2.57.0.98304", first_seen: "2026-10-05T17:12:19Z", parser: 3, heroes: { Whitemane: [{ kind: "ability", id: "WhitemaneDesperatePlea", ko: "절박한 기도", en: "Desperate Plea", key: "Q", changes: [{ old: "40", new: "45" }] }], "Xal'atath": xalNumbers } },
    // a week earlier: not the 10/5 hotfix
    { build: "2.57.0.98304", previous: "2.57.0.98297", first_seen: "2026-09-29T21:46:46Z", parser: 3, heroes: { "Xal'atath": xalNumbers } },
  ],
};

describe("a hotfix Blizzard adds to a note (hero page)", () => {
  it("is the note's hotfix, with Blizzard's lines, its verdict and the note's link", () => {
    const v = heroPatchNotes(notes, "Xal'atath", "2.57.0", "ko", hotfixes);
    expect(v.notes.map((n) => [n.kind, n.id])).toEqual([
      ["note", "24303007#2026-10-05"],
      ["hotfix", "2.57.0.98304"],
    ]);
    const n = v.notes[0]!;
    expect(n).toMatchObject({ hotfix: "2026-10-05", verdict: "mixed", url: "https://news.blizzard.com/ko-kr/article/24303007/", status: "current" });
  });

  it("in the language Blizzard wrote it, its lines as they are", () => {
    const n = heroPatchNotes(notes, "Xal'atath", "2.57.0", "en", hotfixes).notes[0]!;
    expect(n.original).toBeNull();
    expect(n.groups).toEqual([
      { section: "base", level: null, ability: "Void Step [E]", changes: [{ text: "Targeting range reduced from 5 to 2.", direction: "down" }] },
      { section: "talents", level: 7, ability: "Silence of the Lamb", changes: [{ text: "Silence duration increased from 1 to 1.5 seconds.", direction: "up" }] },
    ]);
  });

  it("not translated yet: the build's numbers in the page language, Blizzard's original kept folded (owner 10-06)", () => {
    const n = heroPatchNotes(notes, "Xal'atath", "2.57.0", "ko", hotfixes).notes[0]!;
    // the official verdict and link stay; the lines are the game data's, in Korean
    expect(n).toMatchObject({ hotfix: "2026-10-05", verdict: "mixed", url: "https://news.blizzard.com/ko-kr/article/24303007/" });
    expect(n.groups).toEqual([{ section: "base", level: null, ability: "공허 걸음 [E]", changes: [{ text: "5 → 2", direction: "neutral" }] }]);
    // Blizzard's own text, in the page language wherever Blizzard has it
    expect(n.original!.map((g) => g.ability)).toEqual(["Void Step [E]", "어린 양의 침묵"]);
    expect(n.original![0]!.changes[0]!.text).toBe("Targeting range reduced from 5 to 2.");
  });

  it("not translated and no numbers to show (build not seen): the original stands in, unfolded", () => {
    const n = heroPatchNotes(notes, "Xal'atath", "2.57.0", "ko", null).notes[0]!;
    expect(n.original).toBeNull();
    expect(n.groups[0]!.changes[0]!.text).toBe("Targeting range reduced from 5 to 2.");
  });

  it("a hero the build changed and the hotfix does not name is still unannounced", () => {
    const v = heroPatchNotes(notes, "Whitemane", "2.57.0", "ko", hotfixes);
    expect(v.notes.map((n) => [n.kind, n.id])).toEqual([["hotfix", "2.57.0.98348"]]);
  });

  it("a hotfix whose build the watcher has not seen still shows, without a status", () => {
    const v = heroPatchNotes(notes, "Xal'atath", "2.57.0", "en", null);
    expect(v.notes).toHaveLength(1);
    expect(v.notes[0]).toMatchObject({ kind: "note", hotfix: "2026-10-05", status: null, title: "Live Patch Notes - September 28, 2026" });
  });

  it("a plain note has no hotfix date", () => {
    const plain: PatchNotesFile = { ...notes, notes: [{ ...notes.notes[0]!, heroes: notes.notes[0]!.hotfixes![0]!.heroes, hotfixes: [] }] };
    expect(heroPatchNotes(plain, "Xal'atath", "2.57.0", "ko").notes[0]!.hotfix).toBeNull();
  });
});

const hero = (name: string) => ({ name, slug: name.toLowerCase(), ko: `${name}ko`, en: name, role: "Tank", role_ko: "전사", short_name: name.toLowerCase(), portrait: `img/heroes/${name.toLowerCase()}.png` });
const heroes: HeroTable = { roles: [{ name: "Tank", ko: "전사" }], heroes: ["Xal'atath", "Whitemane"].map(hero) };
const row = (h: string): Row => ({ hero: h, map: "all", wins: 500, losses: 500, games: 1000, bans: 0, pick: 10, popularity: 10, win_rate: 50, ban_rate: 0, ci: null, tier_win_rate: 50 });
const snap = (patch: string, rows: Row[]): Snapshot => ({ patch, mode: "qm", game_type: "qm", league_tier: null, region: null, collected_at: "2026-10-06T00:00:00Z", matches: 1000, rows });
const modes = { qm: { snap: snap("2.57.0", [row("Xal'atath"), row("Whitemane")]), previous: null }, sl: { snap: snap("2.57.0", []), previous: null } };

describe("a hotfix Blizzard adds to a note (patch summary)", () => {
  const s = patchSummary({ patch: "2.57.0", notes, hotfixes, modes, heroes, minGames: 1, locale: "ko" });
  const by = (name: string) => s.rows.find((r) => r.hero.name === name)!;

  it("the hero it names takes its verdict and Blizzard's lines", () => {
    const en = patchSummary({ patch: "2.57.0", notes, hotfixes, modes, heroes, minGames: 1, locale: "en" });
    const row = en.rows.find((r) => r.hero.name === "Xal'atath")!;
    expect(row.verdict).toBe("mixed");
    expect(row.groups.filter((x) => x.source === "note").map((x) => x.ability)).toEqual(["Void Step [E]", "Silence of the Lamb"]);
    // the 98304 numbers are another build's, still unannounced
    expect(row.groups.filter((x) => x.source === "hotfix")).toHaveLength(1);
  });

  it("not translated yet: the build's numbers in the page language, as hotfix lines; the verdict stays official", () => {
    expect(by("Xal'atath").verdict).toBe("mixed");
    const g = by("Xal'atath").groups;
    expect(g.filter((x) => x.source === "note")).toEqual([]);
    expect(g.map((x) => [x.source, x.ability, x.changes[0]!.text])).toEqual([
      ["hotfix", "공허 걸음 [E]", "5 → 2"], // 98348, announced
      ["hotfix", "공허 걸음 [E]", "5 → 2"], // 98304
    ]);
  });

  it("the build stays a hotfix build for the heroes the note does not name", () => {
    expect(by("Whitemane")).toMatchObject({ verdict: null, hotfix: true });
    expect(s.hotfixBuilds).toEqual(["2.57.0.98348", "2.57.0.98304"]);
  });
});

describe("the hotfix's title on the hero page", () => {
  it("names the hotfix by Blizzard's date, then the note it was added to", async () => {
    const { messages } = await import("../src/i18n/messages");
    expect(messages.ko.hero.noteHotfixTitle("10", "5", "라이브 패치 노트")).toBe("핫픽스 10월 5일 · 라이브 패치 노트");
    expect(messages.en.hero.noteHotfixTitle("10", "5", "Live Patch Notes")).toBe("Hotfix Oct 5 · Live Patch Notes");
  });
});
