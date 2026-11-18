import { describe, expect, it } from "vitest";
import { hideNoticeToday, kstDay, noticeHidden, SHUTDOWN_DAY, SHUTDOWN_NOTICE_KEY } from "../src/lib/shutdown";
import { en } from "../src/i18n/en";
import { ko } from "../src/i18n/ko";

const store = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
const throwing = () => {
  throw new Error("SecurityError: storage is disabled");
};

describe("service shutdown notice", () => {
  it("the service ends on 2026-11-28, the last day the HP subscription is paid for", () => {
    expect(SHUTDOWN_DAY).toBe("2026-11-28");
  });

  it("days are Korea time: 15:00 UTC is already the next day in Seoul", () => {
    expect(kstDay(new Date("2026-11-18T14:59:00Z"))).toBe("2026-11-18");
    expect(kstDay(new Date("2026-11-18T15:00:00Z"))).toBe("2026-11-19");
  });

  it("shows on every visit until the visitor hides it for the day", () => {
    const now = new Date("2026-11-18T03:00:00Z");
    expect(noticeHidden(() => store(), now)).toBe(false);
    const s = store();
    expect(hideNoticeToday(() => s, now)).toBe(true);
    expect(s.m.get(SHUTDOWN_NOTICE_KEY)).toBe("2026-11-18");
    expect(noticeHidden(() => s, now)).toBe(true);
  });

  it("'hide for today' lasts until midnight Korea time, then the notice is back", () => {
    const s = store({ [SHUTDOWN_NOTICE_KEY]: "2026-11-18" });
    expect(noticeHidden(() => s, new Date("2026-11-18T14:59:00Z"))).toBe(true);
    expect(noticeHidden(() => s, new Date("2026-11-18T15:00:00Z"))).toBe(false);
  });

  it("storage that throws or holds junk shows the notice rather than breaking the page", () => {
    const now = new Date("2026-11-18T03:00:00Z");
    expect(noticeHidden(throwing, now)).toBe(false);
    expect(noticeHidden(() => ({ getItem: throwing }), now)).toBe(false);
    expect(noticeHidden(() => store({ [SHUTDOWN_NOTICE_KEY]: "soon" }), now)).toBe(false);
    expect(hideNoticeToday(throwing, now)).toBe(false);
    expect(hideNoticeToday(() => ({ setItem: throwing }), now)).toBe(false);
  });

  it("both languages name the shutdown date and say account data is deleted", () => {
    expect(ko.shutdown.body.join(" ")).toContain("2026년 11월 28일");
    expect(en.shutdown.body.join(" ")).toContain("November 28, 2026");
    expect(ko.shutdown.body.join(" ")).toContain("삭제");
    expect(en.shutdown.body.join(" ")).toMatch(/delete/i);
  });
});
