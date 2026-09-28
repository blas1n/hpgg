import { expect, test } from "@playwright/test";

// Home, heroes, hero detail and maps pages against the frozen e2e data set.

test("home: role leaders, movers vs previous patch, map cards, mode toggle", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#meta-line")).toContainText("빠른 대전");
  await expect(page.locator("#role-top .role-card")).toHaveCount(6);
  await expect(page.locator('#role-top .role-card[data-role="Healer"]')).toContainText("화이트메인"); // top QM healer in the fixture
  await expect(page.locator("#movers-sub")).toContainText("직전 패치"); // previous data exists in the fixture
  await expect(page.locator("#map-grid .map-card")).toHaveCount(6);
  await page.locator("#mode-sl").click();
  await expect(page).toHaveURL(/mode=sl/);
  await expect(page.locator("#meta-line")).toContainText("스톰 리그");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.locator("nav.tabs .tab.active")).toHaveText(/홈/);
});

test("heroes: grid of 90 with tier badges, search and role filter", async ({ page }) => {
  await page.goto("./heroes.html");
  await expect(page.locator("#grid .hero-card")).toHaveCount(90);
  await expect(page.locator('#grid .hero-card[data-hero="qhira"] .badge')).toHaveText("S");
  await page.locator("#search").fill("일리");
  await expect(page.locator("#grid .hero-card")).toHaveCount(1);
  await expect(page.locator("#grid .hero-card").first()).toContainText("일리단");
  await page.locator("#search").fill("");
  await page.locator('#roles .chip[data-role="Tank"]').click();
  await expect(page).toHaveURL(/role=Tank/);
  const n = await page.locator("#grid .hero-card").count();
  expect(n).toBeGreaterThan(5);
  expect(n).toBeLessThan(90);
});

test("hero detail: stats, cross-mode line, per-map bars in SL, brackets, vote", async ({ page }) => {
  await page.goto("./hero.html?hero=illidan");
  await expect(page.locator("h1")).toHaveText("일리단");
  await expect(page.locator("#stats .stat-card").first()).toContainText("B"); // QM tier from the fixture
  await expect(page.locator("#stats")).toContainText("스톰 리그에선 A");
  await page.locator("#mode-sl").click();
  await expect(page).toHaveURL(/mode=sl/);
  await expect(page.locator("#stats .stat-card").first()).toContainText("A");
  await expect(page.locator("#maps .rowbar")).toHaveCount(1); // fixture SL has one real map (Cursed Hollow)
  await expect(page.locator('#maps .rowbar[data-map="cursed-hollow"]')).toContainText("저주받은 골짜기");
  await expect(page.locator("#brackets")).toBeVisible();
  await page.locator('#vote [data-vote="up"]').click();
  await expect(page.locator('#vote [data-vote="down"]')).toBeDisabled();
});

test("hero detail: unknown slug shows a message, not a crash", async ({ page }) => {
  await page.goto("./hero.html?hero=nobody");
  await expect(page.locator("#meta-line")).toContainText("그런 영웅이 없습니다");
});

test("maps: cards with images, match counts and top heroes; card links to the map tier table with a banner", async ({ page }) => {
  await page.goto("./maps.html");
  await expect(page.locator("#map-grid .map-card")).toHaveCount(15);
  const card = page.locator('#map-grid .map-card[data-map="cursed-hollow"]');
  await expect(card).toContainText("저주받은 골짜기");
  await expect(card.locator(".map-top-hero")).toHaveCount(3);
  await card.click();
  await expect(page).toHaveURL(/tier\.html\?mode=sl&map=Cursed(\+|%20)Hollow/);
  await expect(page.locator("#map-hero")).toBeVisible();
  await expect(page.locator("#map-hero h1")).toHaveText("저주받은 골짜기");
});

test("tier table shows ▲▼ deltas against the previous patch", async ({ page }) => {
  await page.goto("./tier.html");
  await expect(page.locator('tr.hero[data-hero="qhira"] .delta')).toHaveText("–"); // fixture previous == current
});
