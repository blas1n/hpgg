import { expect, test } from "@playwright/test";
import { FEATURES } from "../src/features";

// 주간 메타 리포트 (owner 2026-10-05). The e2e data carries the real first issue, 2026-w40 (2.57.0's first week,
// against 2.55.17); the model is tested in tests/weekly.test.ts and collector/weekly.py in tests/test_weekly.py.

// a switch (src/features.ts): when off, the export has no report pages
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
  // a hero links to its page in Storm League, the report's basis
  await expect(page.locator("#weekly-top a").first()).toHaveAttribute("href", /\/ko\/hots\/heroes\/[^/]+\/\?mode=sl$/);
  await expect(page.locator("#older-issue, #newer-issue")).toHaveCount(0); // the only issue
});

test("the report is Storm League prose; its evidence card waits for a centre the site knows", async ({ page }) => {
  await page.goto("./meta/");
  await expect(page.locator("#meta-line")).toContainText("폭풍 리그 기준");
  await expect(page.locator("#mode-sl, #mode-qm")).toHaveCount(0); // no Quick Match: no counter picks to explain
  await expect(page.locator("#h-analysis")).toContainText("잘아타스");
  expect(await page.locator("#weekly-analysis p").count()).toBeGreaterThan(2);
  await expect(page.locator('[data-status="draft"]')).toHaveCount(0); // reviewed: no draft badge
  // the e2e hero table predates Xal'atath (90 heroes): no card, and no broken page (tests/weekly.test.ts has the card)
  await expect(page.locator("#h-evidence")).toHaveCount(0);
  await expect(page.locator("#weekly-top a").first()).toHaveAttribute("href", /\?mode=sl$/);
});

test("an issue that does not exist is a 404", async ({ request }) => {
  expect((await request.get("/ko/hots/meta/2026-w01/")).status()).toBe(404);
});
