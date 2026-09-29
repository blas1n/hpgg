import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
});

// Home + global header, against the frozen e2e data set (web/tests/e2e-data).

test("home: role leaders, top 10, movers, map cards and the mode toggle", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#meta-line")).toContainText("빠른 대전");
  await expect(page.locator('#role-top [data-card="role"]')).toHaveCount(6);
  await expect(page.locator('#role-top [data-card="role"][data-role="Healer"]')).toContainText("화이트메인"); // top QM healer in the fixture
  await expect(page.locator("#top10 tbody tr")).toHaveCount(10);
  await expect(page.locator("#top10 tbody tr").first()).toHaveAttribute("data-hero", "qhira");
  await expect(page.locator("#movers-sub")).toContainText("직전 패치"); // previous data exists in the fixture
  await expect(page.locator('#map-grid [data-card="map"]')).toHaveCount(1); // the fixture's SL has one real map
  await expect(page.locator('#map-grid [data-card="map"][data-map="cursed-hollow"]')).toHaveAttribute("href", /\/hots\/tier\/\?mode=sl&map=Cursed/);
  await page.locator("#mode-sl").click();
  await expect(page).toHaveURL(/mode=sl/);
  await expect(page.locator("#meta-line")).toContainText("폭풍 리그");
  await expect(page.locator('#role-top [data-card="role"]').first()).toHaveAttribute("href", /\?mode=sl$/);
});

test("home: one compact player-search row on top, today's meta right under it", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#hero-search")).toHaveCount(0);
  const box = (await page.locator("#home-player-search").boundingBox())!;
  expect(box.height).toBeLessThan(60); // one row, not a banner
  const top = (await page.locator("#meta-line").boundingBox())!.y;
  expect(top).toBeLessThan(330); // still above the fold on a phone
});

test("home: ?mode=sl in the URL opens Storm League", async ({ page }) => {
  await page.goto("./?mode=sl");
  await expect(page.locator("#meta-line")).toContainText("폭풍 리그");
  await expect(page.locator("#mode-sl")).toHaveAttribute("aria-pressed", "true");
});

test("layout: no horizontal overflow on a phone, active nav item marked", async ({ page }) => {
  for (const path of ["./", "./tier/", "./heroes/", "./heroes/illidan/", "./maps/", "./players/"]) {
    await page.goto(path);
    await expect(page.locator("header").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
  await page.goto("./tier/");
  await expect(page.locator('nav a[aria-current="page"]:visible')).toHaveText("영웅 티어");
});

test("header search: 초성 query, keyboard selection opens the hero page", async ({ page }) => {
  await page.goto("./");
  const box = page.locator("#site-search");
  await box.fill("ㅇㄹㄷ");
  const first = page.getByRole("option").first();
  await expect(first).toHaveAttribute("data-hero", "illidan");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/hots\/heroes\/illidan\/$/);
  await expect(page.locator("h1")).toHaveText("일리단");
});

test("header search: a query with no match says so; '/' focuses the box", async ({ page }) => {
  await page.goto("./tier/");
  await page.locator("body").press("/");
  await expect(page.locator("#site-search")).toBeFocused();
  await page.keyboard.type("zzzz");
  await expect(page.getByRole("listbox")).toContainText("맞는 영웅이 없습니다");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("old .html addresses forward to the new routes", async ({ page }) => {
  await page.goto("./hero.html?hero=illidan&mode=sl");
  await expect(page).toHaveURL(/\/hots\/heroes\/illidan\/\?mode=sl$/);
  await page.goto("./tier.html?mode=sl&role=Healer");
  await expect(page).toHaveURL(/\/hots\/tier\/\?mode=sl&role=Healer$/);
});

test("footer offers a contact address", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator('footer a[href="mailto:contact@hpgg.win"]')).toBeVisible();
});
