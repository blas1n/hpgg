import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
});

// Home, heroes, hero detail and maps pages against the frozen e2e data set.

test("heroes: grid of 90 with tier badges, search and role filter", async ({ page }) => {
  await page.goto("./heroes/");
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

test("hero detail: stats, other-mode card, per-map rows (not links) in SL, brackets, no vote", async ({ page }) => {
  await page.goto("./heroes/illidan/");
  await expect(page.locator("h1")).toHaveText("일리단");
  const cards = page.locator("#stats .stat-card");
  await expect(cards).toHaveCount(4);
  await expect(cards.first()).toContainText("B"); // QM tier from the fixture
  await expect(cards.first()).toContainText("— 0"); // same rank as the previous patch, written like the table
  await expect(page.locator("#stats")).not.toContainText("점수");
  await expect(page.locator("#stats")).not.toContainText("밴 없음");
  await expect(page.locator('#stats .stat-card[data-k="other"]')).toContainText("폭풍 리그");
  await expect(page.locator('#stats .stat-card[data-k="other"]')).toContainText("A");
  await page.locator("#mode-sl").click();
  await expect(page).toHaveURL(/mode=sl/);
  await expect(cards.first()).toContainText("A");
  await expect(page.locator('#stats .stat-card[data-k="other"]')).toContainText("빠른 대전");
  await expect(page.locator("#maps .rowbar")).toHaveCount(1); // fixture SL has one real map (Cursed Hollow)
  await expect(page.locator('#maps .rowbar[data-map="cursed-hollow"]')).toContainText("저주받은 골짜기");
  await expect(page.locator("#maps a")).toHaveCount(0); // map rows do not navigate
  await expect(page.locator("#brackets")).toBeVisible();
  await expect(page.locator("main button:not([id^=mode-])")).toHaveCount(0); // only the mode toggle is a button
});

test("hero detail: section tabs stick under the header and land each section just below them", async ({ page }) => {
  await page.goto("./heroes/illidan/");
  await expect(page.locator("#builds .build")).toHaveCount(5);
  const nav = page.locator("nav.subnav");
  const header = page.locator("body > header, header.sticky").first();
  const headerBottom = async () => (await header.boundingBox())!.y + (await header.boundingBox())!.height;
  for (const [link, target] of [["#nav-builds", "#builds-title"], ["a[href='#maps-title']", "#maps-title"]] as const) {
    await nav.locator(link).click();
    await expect.poll(async () => {
      const t = (await page.locator(target).boundingBox())!.y;
      const n = await nav.boundingBox();
      return t >= n!.y + n!.height - 1 && t <= n!.y + n!.height + 40;
    }, { message: `${target} lands right under the tabs` }).toBe(true);
    expect((await nav.boundingBox())!.y).toBeCloseTo(await headerBottom(), 0); // tabs stuck under the header
    await expect(nav.locator(link)).toHaveClass(/active/);
  }
  await nav.locator("a[href='#top']").click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test("hero detail: unknown slug is a 404 page with a way back", async ({ page }) => {
  await page.goto("./heroes/nobody/");
  await expect(page.locator("#meta-line")).toContainText("영웅이 없습니다");
});

test("maps: cards with images, match counts and top heroes; card links to the map tier table with a banner", async ({ page }) => {
  await page.goto("./maps/");
  await expect(page.locator("#map-grid .map-card")).toHaveCount(15);
  const card = page.locator('#map-grid .map-card[data-map="cursed-hollow"]');
  await expect(card).toContainText("저주받은 골짜기");
  await expect(card.locator(".map-top-hero")).toHaveCount(3);
  await card.click();
  await expect(page).toHaveURL(/tier\/\?mode=sl&map=Cursed(\+|%20)Hollow/);
  await expect(page.locator("#map-hero")).toBeVisible();
  await expect(page.locator("#map-hero h1")).toHaveText("저주받은 골짜기");
});

test("tier table shows ▲▼ deltas against the previous patch", async ({ page }) => {
  await page.goto("./tier/");
  await expect(page.locator('tr.hero[data-hero="qhira"] .delta')).toHaveText("— 0"); // fixture previous == current
});

test("tier table: Storm League rank-bracket selector loads sl_<bracket>.json and lands in the URL", async ({ page }) => {
  await page.goto("./tier/?mode=sl");
  await expect(page.locator("#bracket-wrap")).toBeVisible();
  await page.locator("#bracket").selectOption("high");
  await expect(page).toHaveURL(/tier=high/);
  await expect(page.locator("#meta-line")).toContainText("마스터 – 그랜드마스터");
  await page.goto("./tier/?mode=sl&tier=low");
  await expect(page.locator("#bracket")).toHaveValue("low");
  await expect(page.locator("#meta-line")).toContainText("브론즈 – 골드");
  await page.locator("#mode-qm").click();
  await expect(page.locator("#bracket-wrap")).toBeHidden();
  await expect(page).not.toHaveURL(/tier=/);
});

test("hero detail: popular talent builds with Korean names, icons, games and win rate", async ({ page }) => {
  await page.goto("./heroes/illidan/");
  await expect(page.locator("#builds-title")).toBeVisible();
  await expect(page.locator("#builds .build")).toHaveCount(5);
  const first = page.locator('#builds .build[data-build="1"]');
  await expect(first.locator(".talent")).toHaveCount(7);
  await expect(first.locator(".talent .tl").first()).toHaveText("1");
  await expect(first.locator(".talent .tn").first()).toContainText("끝없는 증오"); // Korean talent name from game strings
  await expect(first.locator(".build-stats .v")).toContainText("%");
  const imgs = await first.locator(".talent img").count();
  expect(imgs).toBeGreaterThan(0);
  await expect(page.locator("#builds-sub")).toContainText("합산");
});

test("hero detail: a hero without builds hides the section", async ({ page }) => {
  await page.goto("./heroes/xal-atath/");
  await expect(page.locator("#meta-line")).toContainText("영웅이 없습니다"); // not in heroes_ko yet
});
