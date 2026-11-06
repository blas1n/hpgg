import { expect, test, type Page } from "@playwright/test";

// 전장 filter on the hero page (owner 2026-11-06): in the page's own filter row, next to region and bracket, like the
// tier table's. It turns the stat cards into the hero on that map, ranked among the heroes there as the tier table's map
// filter ranks them. The talent builds stay the builds of every map, and say so (no per-map builds: HP's builds
// endpoint cannot be asked per map often enough, and per-level talent picks are not builds).

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
});

test("a map in the filter row: the cards are the hero on that map; the address keeps it with the view", async ({ page }) => {
  await page.goto("./heroes/illidan/?mode=sl&tier=high");
  const games = page.locator('[data-stat="wr"] [data-sub]');
  const before = await games.textContent();
  await page.locator("#hero-map").selectOption("cursed-hollow");
  await expect(page).toHaveURL(/mode=sl&tier=high&map=cursed-hollow/);
  await expect(page.locator("#hero-bracket")).toHaveValue("high");
  await expect(games).not.toHaveText(before!);
  await expect(page.locator("[data-view]")).toContainText("저주받은 골짜기");
  await page.locator("#hero-map").selectOption("");
  await expect(games).toHaveText(before!);
  await expect(page).not.toHaveURL(/map=/);
});

test("the cards are that map's row, the same numbers as the map list below", async ({ page }) => {
  await page.goto("./heroes/illidan/?mode=sl&map=cursed-hollow");
  // the e2e Storm League file has one real map: Cursed Hollow, 232 games
  await expect(page.locator('[data-stat="wr"] [data-sub]')).toHaveText("232게임");
  const row = page.locator('#maps [data-map="cursed-hollow"] [data-wr]');
  await expect(page.locator('[data-stat="wr"] > div').nth(1)).toHaveText((await row.textContent())!);
});

test("a map the view has no game on: the cards say so, not the whole pool's numbers", async ({ page }) => {
  await page.goto("./heroes/illidan/?mode=sl&map=sky-temple");
  await expect(page.locator("#stats")).toContainText("이 전장의 표본이 없습니다");
});

test("the talent builds stay every map's, and say so", async ({ page }) => {
  await page.goto("./heroes/illidan/?mode=sl&map=cursed-hollow");
  await expect(page.locator("#builds [data-build]").first()).toBeVisible();
  await expect(page.locator("#builds-sub")).toContainText("모든 전장 기준");
  await page.goto("./heroes/illidan/?mode=sl");
  await expect(page.locator("#builds-sub")).not.toContainText("모든 전장 기준");
});

test("the tier table's map filter carries into the hero page", async ({ page }) => {
  await page.goto("./tier/?mode=sl&map=Cursed+Hollow");
  const link = page.locator('#rows tr[data-hero="illidan"] a[data-link]');
  await expect(link).toHaveAttribute("href", "/ko/hots/heroes/illidan/?mode=sl&map=cursed-hollow");
  await link.click();
  await expect(page.locator("#hero-map")).toHaveValue("cursed-hollow");
  await expect(page.locator('[data-stat="wr"] [data-sub]')).toHaveText("232게임");
});

test("a map the site does not have is ignored", async ({ page }) => {
  await page.goto("./heroes/illidan/?mode=sl&map=nowhere");
  await expect(page.locator("#hero-map")).toHaveValue("");
  await expect(page.locator('[data-stat="wr"] [data-sub]')).toHaveText("2,912게임");
});

for (const width of [390, 1280]) {
  test(`the filter row at ${width}px: no horizontal scroll, English too`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const base of ["./heroes/illidan/", "/en/hots/heroes/illidan/"]) {
      await page.goto(`${base}?mode=sl&map=cursed-hollow`);
      await expect(page.locator("#hero-map")).toHaveValue("cursed-hollow");
      expect(await noHorizontalScroll(page)).toBe(true);
    }
  });
}
