/**
 * Service shutdown (owner, 2026-11-18): the owner quit the game and cancelled the HP API subscription, which stays
 * paid for through SHUTDOWN_DAY; hpgg.win closes that day. Every page opens a notice until the visitor hides it for
 * the day ("오늘 하루 보지 않기", the convention Korean sites use). Days are Korea time, like the rest of the site.
 */
export const SHUTDOWN_DAY = "2026-11-28";
export const SHUTDOWN_NOTICE_KEY = "hpgg-shutdown-notice-hidden";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-11-18" in Korea time (UTC+9, no daylight saving). */
export function kstDay(now: Date): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

type Get = () => Pick<Storage, "getItem"> | null | undefined;
type Put = () => Pick<Storage, "setItem"> | null | undefined;

/** True when the visitor hid the notice today (or a later day). Unreadable storage shows the notice. */
export function noticeHidden(storage: Get, now: Date): boolean {
  try {
    const day = storage()?.getItem(SHUTDOWN_NOTICE_KEY);
    return !!day && DAY.test(day) && day >= kstDay(now);
  } catch {
    return false;
  }
}

/** Remember "hide for today"; false when the browser refuses (the notice still closes for this page). */
export function hideNoticeToday(storage: Put, now: Date): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(SHUTDOWN_NOTICE_KEY, kstDay(now));
    return true;
  } catch {
    return false;
  }
}
