import { expect, test } from "@playwright/test";
import { FEATURES } from "../src/features";

// 주간 메타 리포트 (owner 2026-10-05). The e2e data carries the real first issue, 2026-w40 (2.57.0's first week,
// against 2.55.17); the model is tested in tests/weekly.test.ts and collector/weekly.py in tests/test_weekly.py.

// switched off on the live site (owner 2026-10-05, src/features.ts): the export has no report pages
test.skip(!FEATURES.weekly, "주간 메타 리포트 is switched off (src/features.ts)");

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
});

test("주간 메타 in the menu opens the newest issue", async ({ page }) => {
  await page.goto("./");
  await page.locator('header a[data-page="meta"]:visible').first().click();
  await expect(page).toHaveURL(/\/ko\/hots\/meta\/$/);
  await expect(page.locator("h1")).toHaveText("주간 메타 리포트");
  await expect(page.locator("#meta-line")).toContainText("2026년 40주 · 9/28 – 10/4");
  await expect(page.locator("#meta-line")).toContainText("패치 2.57.0 첫 주");
});

test("an issue has its own address and the report's sections", async ({ page }) => {
  await page.goto("./meta/2026-w40/");
  await expect(page.locator("#weekly-summary li")).toHaveCount(3);
  await expect(page.locator("#weekly-summary")).toContainText("가장 많이 오른 영웅");
  await expect(page.locator("#weekly-top li")).toHaveCount(10);
  await expect(page.locator("#weekly-up li").first()).toBeVisible();
  await expect(page.locator("#weekly-down li").first()).toBeVisible();
  await expect(page.locator("#weekly-daily svg").first()).toBeVisible();
  // a hero links to its page in the same mode
  await expect(page.locator("#weekly-top a").first()).toHaveAttribute("href", /\/ko\/hots\/heroes\/[^/]+\/$/);
  await expect(page.locator("#older-issue, #newer-issue")).toHaveCount(0); // the only issue
});

test("the mode toggle swaps the numbers and lands in the URL", async ({ page }) => {
  await page.goto("./meta/");
  const first = await page.locator("#weekly-top li").first().innerText();
  await page.locator("#mode-sl").click();
  await expect(page).toHaveURL(/\/meta\/\?mode=sl$/);
  await expect(page.locator("#weekly-top li").first()).not.toHaveText(first);
  await expect(page.locator("#weekly-top a").first()).toHaveAttribute("href", /\?mode=sl$/);
});

test("an issue that does not exist is a 404", async ({ request }) => {
  expect((await request.get("/ko/hots/meta/2026-w01/")).status()).toBe(404);
});
