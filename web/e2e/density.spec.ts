import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
});

// Desktop density (#3) and the design review (#16), measured at 1280 px against the frozen e2e data set.

test.describe("desktop 1280", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("tier table: its own tier column, compact rows, at least 14 heroes above the fold", async ({ page }) => {
    await page.goto("./tier/");
    const rows = page.locator("#rows tr[data-hero]");
    await expect(rows.first().locator('td[data-col="tier"] .tier-badge')).toHaveText("S");
    const portraitBadges = page.locator('#rows tr[data-hero] td[data-col="hero"] .tier-badge');
    expect(await portraitBadges.evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 0).length)).toBe(0); // not clipped on the portrait any more
    const h = (await rows.nth(3).boundingBox())!.height;
    expect(h).toBeLessThanOrEqual(42);
    const visible = await rows.evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().bottom <= innerHeight).length);
    expect(visible).toBeGreaterThanOrEqual(14);
  });

  test("tier table: role column and win-rate interval on desktop, no wasted hero column", async ({ page }) => {
    await page.goto("./tier/");
    const r = page.locator('#rows tr[data-hero="illidan"]');
    await expect(r.locator('td[data-col="role"]')).toHaveText("근접 암살자");
    await expect(r.locator('td[data-col="win_rate"]')).toContainText("±");
    const hero = (await page.locator('th[data-col="hero"]').boundingBox())!.width;
    expect(hero).toBeLessThanOrEqual(360);
  });

  test("tier table: tier groups when ranked by score, none when sorted by another column", async ({ page }) => {
    await page.goto("./tier/");
    await expect(page.locator("#rows tr[data-tier-group]")).toHaveCount(6);
    await expect(page.locator('#rows tr[data-tier-group="S"]')).toContainText("S");
    await page.locator('th[data-sort="pick"] button').click();
    await expect(page.locator("#rows tr[data-tier-group]")).toHaveCount(0);
  });

  test("tier table: the column header stays under the site header while scrolling", async ({ page }) => {
    await page.goto("./tier/");
    await page.mouse.wheel(0, 2500);
    await expect.poll(async () => (await page.locator('th[data-col="hero"]').boundingBox())!.y).toBeLessThan(80);
    const headerH = await page.evaluate(() => document.querySelector("header")!.getBoundingClientRect().height);
    const y = (await page.locator('th[data-col="hero"]').boundingBox())!.y;
    expect(Math.abs(y - headerH)).toBeLessThanOrEqual(2);
  });

  test("hero detail: header and stats share a row, the other sections sit next to the maps, above the fold", async ({ page }) => {
    await page.goto("./heroes/illidan/?mode=sl");
    const h1 = (await page.locator("h1").boundingBox())!;
    const stats = (await page.locator("#stats").boundingBox())!;
    expect(Math.abs(stats.y - h1.y)).toBeLessThan(80); // same band as the title
    const maps = (await page.locator("#maps-title").boundingBox())!;
    const right = (await page.locator("#brackets-title").boundingBox())!;
    expect(right.x).toBeGreaterThan(maps.x + 300); // a second column
    expect(right.y).toBeLessThan(500);
    const builds = (await page.locator("#builds-title").boundingBox())!;
    expect(builds.x).toBe(right.x); // builds sit in the same right column
    const row = (await page.locator("#maps [data-map]").first().boundingBox())!;
    expect(row.height).toBeLessThanOrEqual(44);
  });
});

test("no functional text under 11 px on the hero page", async ({ page }) => {
  await page.goto("./heroes/illidan/");
  const small = await page.locator("main").evaluate((m) =>
    [...m.querySelectorAll("*")]
      .filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()) && !e.closest(".tier-badge"))
      .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 11)
      .map((e) => e.textContent!.trim().slice(0, 20)),
  );
  expect(small).toEqual([]);
});
