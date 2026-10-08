import { describe, expect, it } from "vitest";
import { fullAfterAt } from "../src/lib/matches";
import { ko } from "../src/i18n/ko";
import { en } from "../src/i18n/en";

// a basic list held back by the quota says when the detailed one returns (owner 2026-10-08)
describe("fullAfterAt", () => {
  const now = new Date("2026-10-08T01:00:00Z"); // 10:00 KST
  const tz = "Asia/Seoul";
  it("names today, tomorrow or the date in the viewer's zone", () => {
    expect(fullAfterAt("2026-10-08T06:48:24Z", now, tz)).toEqual({ day: "today", time: "15:48", month: 10, date: 8 });
    expect(fullAfterAt("2026-10-08T16:10:00Z", now, tz)).toEqual({ day: "tomorrow", time: "01:10", month: 10, date: 9 });
    expect(fullAfterAt("2026-10-10T03:05:00Z", now, tz)).toEqual({ day: "later", time: "12:05", month: 10, date: 10 });
  });
  it("is null without a time or with a bad one", () => {
    expect(fullAfterAt(null, now, tz)).toBeNull();
    expect(fullAfterAt("soon", now, tz)).toBeNull();
  });
  it("reads as a sentence in both languages", () => {
    const at = fullAfterAt("2026-10-08T06:48:24Z", now, tz)!;
    expect(ko.players.games.basicQuota(ko.players.games.when(at))).toContain("오늘 15:48");
    expect(en.players.games.basicQuota(en.players.games.when(at))).toContain("today 15:48");
    expect(ko.players.games.when({ day: "later", time: "12:05", month: 10, date: 10 })).toBe("10월 10일 12:05");
    expect(ko.players.games.basicSlow).toContain("잠시 뒤");
  });
});
