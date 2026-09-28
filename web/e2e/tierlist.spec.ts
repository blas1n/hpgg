import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
});

// Built against web/tests/e2e-data (frozen 2026-09-28 fixtures), see `npm run e2e`.

const row = (page: Page, slug: string) => page.locator(`tr.hero[data-hero="${slug}"]`);
const tierOf = async (page: Page, slug: string) => row(page, slug).getAttribute("data-tier");
const detail = (page: Page, slug: string) => page.locator(`tr.detail-row[data-hero="${slug}"]`);

test("default view is Quick Match, all maps, no map dropdown, ban column hidden; expected tiers", async ({ page }) => {
  await page.goto("./tier/");
  await expect(page.locator("#meta-line")).toContainText("빠른 대전");
  await expect(page.locator("#mode-qm")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#map-wrap")).toBeHidden();
  await expect(page.locator("th.col-ban")).toBeHidden();
  expect(await tierOf(page, "illidan")).toBe("B");
  expect(await tierOf(page, "azmodan")).toBe("S");
  expect(await tierOf(page, "brightwing")).toBe("A");
  // default order is by score: first row is rank #1
  await expect(page.locator("tbody tr.hero").first()).toHaveAttribute("data-hero", "qhira");
  await expect(page.locator("tbody tr.hero").first().locator(".rank")).toHaveText("1");
});

test("score, win rate, pick rate and sample size all show plain numbers (no single-metric emphasis)", async ({ page }) => {
  await page.goto("./tier/");
  const r = row(page, "illidan");
  for (const cls of ["score", "wr", "pick", "games"]) await expect(r.locator(`td.${cls} .v`)).not.toHaveText("");
  await expect(r.locator("td.wr .v")).toContainText("%");
  await expect(r.locator(".avatar .badge")).toHaveText("B");
});

test("sorting by pick rate reorders rows and is reflected in the URL; tiers stay", async ({ page }) => {
  await page.goto("./tier/");
  await page.locator('th[data-sort="pick"] .sort').click();
  await expect(page).toHaveURL(/sort=pick/);
  await expect(page.locator('th[data-sort="pick"]')).toHaveAttribute("aria-sort", "descending");
  await expect(page.locator("tbody tr.hero").first()).toHaveAttribute("data-hero", "abathur"); // 35% pick in QM
  expect(await tierOf(page, "abathur")).toBe("S");
  await page.locator('th[data-sort="pick"] .sort').click();
  await expect(page.locator('th[data-sort="pick"]')).toHaveAttribute("aria-sort", "ascending");
  await expect(page).toHaveURL(/dir=asc/);
});

test("role filter hides other roles but keeps tiers (computed on everyone)", async ({ page }) => {
  await page.goto("./tier/");
  await page.locator("#roles .chip", { hasText: "치유사" }).click();
  await expect(page).toHaveURL(/role=Healer/);
  await expect(row(page, "brightwing")).toBeVisible();
  await expect(row(page, "illidan")).toHaveCount(0);
  expect(await tierOf(page, "brightwing")).toBe("A");
});

test("Storm League: map dropdown and ban column appear, tiers change", async ({ page }) => {
  await page.goto("./tier/");
  await page.locator("#mode-sl").click();
  await expect(page.locator("#map-wrap")).toBeVisible();
  await expect(page.locator("th.col-ban")).toBeVisible();
  await expect(page).toHaveURL(/mode=sl/);
  expect(await tierOf(page, "illidan")).toBe("A");
  expect(await tierOf(page, "brightwing")).toBe("F");
  await expect(row(page, "brightwing").locator("td.ban .v")).toContainText("%");
  await row(page, "brightwing").click();
  await expect(detail(page, "brightwing")).toBeVisible();
  await expect(detail(page, "brightwing").locator(".d-ban")).toContainText("%");
});

test("selecting one map excludes thin rows from the cut and lists them as grey", async ({ page }) => {
  await page.goto("./tier/?mode=sl");
  await page.locator("#map").selectOption("Cursed Hollow");
  await expect(page).toHaveURL(/map=Cursed(\+|%20)Hollow/);
  await expect(page.locator("#meta-line")).toContainText("저주받은 골짜기");
  await expect(page.locator("#grey-wrap")).toBeVisible();
  const greyCount = await page.locator("#grey .chip").count();
  expect(greyCount).toBeGreaterThan(0);
  const firstGrey = await page.locator("#grey .chip").first().getAttribute("data-hero");
  await expect(row(page, firstGrey!)).toHaveCount(0);
});

test("detail row links to the hero page and asks for no vote (voting removed 2026-09-28)", async ({ page }) => {
  await page.goto("./tier/");
  await row(page, "illidan").click();
  const d = detail(page, "illidan");
  await expect(d).toBeVisible(); // control: the row we inspect is really open
  await expect(d.locator("a.d-link")).toHaveAttribute("href", "/hots/heroes/illidan/");
  await expect(d.locator("button")).toHaveCount(0);
});

test("an opened row spans exactly the visible columns, so the table keeps its full width on a phone", async ({ page }) => {
  await page.goto("./tier/");
  await row(page, "qhira").click();
  const visibleCols = await page.locator("#table thead th:visible").count();
  expect(visibleCols).toBe(5); // phone: rank, hero, score, win rate, pick
  await expect(detail(page, "qhira").locator("td")).toHaveAttribute("colspan", String(visibleCols));
  const tableW = (await page.locator("#table").boundingBox())!.width;
  const rowW = (await row(page, "qhira").boundingBox())!.width;
  expect(Math.abs(tableW - rowW)).toBeLessThanOrEqual(1);
  await expect(row(page, "qhira").locator(".name")).toBeVisible();
});

test("?patch=previous shows the banner and previous-patch data; state round-trips through the URL", async ({ page }) => {
  await page.goto("./tier/?patch=previous");
  await expect(page.locator("#patch-banner")).toBeVisible();
  await expect(page.locator("#patch-banner")).toContainText("이전 패치");
  await expect(page.locator("#meta-line")).toContainText("2.55.17.97771");
  await page.goto("./tier/?mode=sl&map=Cursed%20Hollow&role=Tank&sort=win_rate");
  await expect(page.locator("#mode-sl")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#map")).toHaveValue("Cursed Hollow");
  await expect(page.locator('#roles .chip[data-role="Tank"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('th[data-sort="win_rate"]')).toHaveAttribute("aria-sort", "descending");
});

test("no horizontal scroll on a phone and the formula is printed", async ({ page }) => {
  await page.goto("./tier/?mode=sl");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const tableOverflow = await page.locator("#table").evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(tableOverflow).toBeLessThanOrEqual(0);
  await expect(page.locator("#formula")).toContainText("픽률 × (승률 − 50) × 3");
  await expect(page.locator("footer")).toContainText("Data provided by");
});
