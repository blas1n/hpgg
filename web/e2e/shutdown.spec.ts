import { expect, test } from "@playwright/test";

// Service shutdown (2026-11-28): every page opens the notice until the visitor hides it for the day.
// The other specs start with it hidden (playwright.config.ts storageState); this one starts from a fresh browser.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
});

const notice = (page: import("@playwright/test").Page) => page.getByRole("dialog", { name: "hpgg.win 서비스 종료 안내" });

test("shutdown: a first visit sees the notice with the date, on any page", async ({ page }) => {
  await page.goto("./");
  await expect(notice(page)).toBeVisible();
  await expect(notice(page)).toContainText("2026년 11월 28일");
  await page.goto("./heroes/");
  await expect(notice(page)).toBeVisible();
});

test("shutdown: the English pages show it in English", async ({ page }) => {
  await page.goto("/en/hots/");
  await expect(page.getByRole("dialog", { name: "hpgg.win is shutting down" })).toContainText("November 28, 2026");
});

test("shutdown: Close hides it for this page only; it is back on the next visit", async ({ page }) => {
  await page.goto("./");
  await notice(page).getByRole("button", { name: "닫기" }).click();
  await expect(notice(page)).toBeHidden();
  await page.reload();
  await expect(notice(page)).toBeVisible();
});

test("shutdown: Escape closes it", async ({ page }) => {
  await page.goto("./");
  await expect(notice(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(notice(page)).toBeHidden();
});

test("shutdown: 'hide for today' keeps it closed across pages and reloads", async ({ page }) => {
  await page.goto("./");
  await notice(page).getByRole("button", { name: "오늘 하루 보지 않기" }).click();
  await expect(notice(page)).toBeHidden();
  await page.reload();
  await page.goto("./heroes/");
  await expect(page.locator("h1").first()).toBeVisible();
  await expect(notice(page)).toBeHidden();
});
