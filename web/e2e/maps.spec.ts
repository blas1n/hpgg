import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
});

// Map detail pages (#9), against the frozen e2e data set (its Storm League has one real map, Cursed Hollow).

test("map detail: banner, the three official objective steps with their source, top heroes, a way to the tier table", async ({ page }) => {
  await page.goto("./maps/cursed-hollow/");
  await expect(page.locator("h1")).toHaveText("저주받은 골짜기");
  await expect(page.locator("#map-banner img")).toBeVisible();
  const steps = page.locator("#objective li");
  await expect(steps).toHaveCount(3);
  await expect(steps.first()).toContainText("공물 수집");
  await expect(page.locator("#objective-source")).toHaveAttribute("href", /^https:\/\/web\.archive\.org\/web\/\d+\/https:\/\/heroesofthestorm\.com\/ko-kr\/battlegrounds\/cursed-hollow\/$/);
  const rows = page.locator("#map-top tr[data-hero]");
  expect(await rows.count()).toBeGreaterThan(0);
  expect(await rows.count()).toBeLessThanOrEqual(10);
  const wr = await rows.locator('[data-col="win_rate"] [data-v]').allTextContents();
  const n = wr.map((t) => parseFloat(t));
  expect(n).toEqual([...n].sort((a, b) => b - a));
  await expect(rows.first().locator("a")).toHaveAttribute("href", /\/hots\/heroes\/[a-z-]+\/\?mode=sl$/);
  await expect(page.locator("#map-tier-link a")).toHaveAttribute("href", /\/hots\/tier\/\?mode=sl&map=Cursed(\+|%20)Hollow/);
  await expect(page.locator('nav a[aria-current="page"]:visible')).toHaveText("전장");
});

test("map detail: a map without Storm League games still explains the objective and says there is no sample", async ({ page }) => {
  await page.goto("./maps/towers-of-doom/");
  await expect(page.locator("h1")).toHaveText("파멸의 탑");
  await expect(page.locator("#objective li")).toHaveCount(3);
  await expect(page.locator("#map-top")).toContainText("표본이 없습니다");
  await expect(page.locator("#map-top tr[data-hero]")).toHaveCount(0);
});

test("maps: every card opens its map page", async ({ page }) => {
  await page.goto("./maps/");
  await expect(page.locator('#map-grid a[data-map="cursed-hollow"]')).toHaveAttribute("href", "/hots/maps/cursed-hollow/");
  await page.locator('#map-grid a[data-map="alterac-pass"]').click();
  await expect(page).toHaveURL(/\/hots\/maps\/alterac-pass\/$/);
  await expect(page.locator("#objective li").first()).toContainText("포로수용소");
});

test("map detail: unknown slug is a 404", async ({ page }) => {
  const res = await page.goto("./maps/nowhere/");
  expect(res?.status()).toBe(404);
});

test("map detail: no horizontal scroll on a phone", async ({ page }) => {
  await page.goto("./maps/cursed-hollow/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
