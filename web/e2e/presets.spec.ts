import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
});

// Formula presets on the tier page (#2), against the frozen e2e data set (2026-09-28 fixtures).

const row = (page: Page, slug: string) => page.locator(`#rows tr[data-hero="${slug}"]`);

test("presets: the default view is 아이치, prints its formula and marks nothing", async ({ page }) => {
  await page.goto("./tier/");
  await expect(page.locator("#preset")).toHaveValue("aichi");
  await expect(page.locator("#formula")).toContainText("티어 점수 = 픽률 × (승률 − 50) × 3");
  await expect(page.locator("#preset-diff")).toHaveCount(0);
  await expect(page.locator("#rows tr[data-changed]")).toHaveCount(0);
  await expect(row(page, "qhira").locator('td[data-col="score"] [data-v]')).toHaveText("+402");
});

test("presets: choosing 가산식 re-tiers, marks heroes whose tier moved, prints its formula and lands in the URL", async ({ page }) => {
  await page.goto("./tier/");
  await expect(row(page, "whitemane")).toHaveAttribute("data-tier", "S");
  await page.locator("#preset").selectOption("additive");
  await expect(page).toHaveURL(/preset=additive/);
  await expect(row(page, "whitemane")).toHaveAttribute("data-tier", "A");
  await expect(row(page, "whitemane")).toHaveAttribute("data-changed", "S");
  await expect(row(page, "whitemane").locator("[data-base-tier]")).toHaveText("기본 S");
  await expect(row(page, "illidan")).not.toHaveAttribute("data-changed", /.*/); // B under both
  await expect(page.locator("#rows tr[data-changed]")).toHaveCount(31); // 31 QM heroes change tier in the fixture
  await expect(page.locator("#preset-diff")).toContainText("31");
  await expect(page.locator("#formula")).toContainText("티어 점수 = (승률 − 50) + 픽률 × 0.15");
  await expect(page.locator("#formula")).not.toContainText("× 3");
  await page.locator("#formula + details summary").click();
  await expect(page.locator("#formula + details pre")).toContainText("점수  = (WRs − 50) + 픽률 × 0.15");
  // back to the default: the URL is clean again and nothing is marked
  await page.locator("#preset-diff button").click();
  await expect(page).not.toHaveURL(/preset=/);
  await expect(page.locator("#rows tr[data-changed]")).toHaveCount(0);
  await expect(row(page, "whitemane")).toHaveAttribute("data-tier", "S");
});

test("presets: ?preset= opens with that formula, also in Storm League (Brightwing F → A under 가산식)", async ({ page }) => {
  await page.goto("./tier/?mode=sl&preset=additive");
  await expect(page.locator("#preset")).toHaveValue("additive");
  await expect(row(page, "brightwing")).toHaveAttribute("data-tier", "A");
  await expect(row(page, "brightwing")).toHaveAttribute("data-changed", "F");
  await expect(page.locator("#formula")).toContainText("+ 밴률 × 0.15");
  await page.goto("./tier/?preset=winrate");
  await expect(page.locator("#preset")).toHaveValue("winrate");
  await expect(page.locator("#formula")).toContainText("티어 점수 = 승률");
  await expect(row(page, "qhira").locator('td[data-col="score"] [data-v]')).not.toContainText("+"); // a win rate, not a signed score
  await page.goto("./tier/?preset=bogus");
  await expect(page.locator("#preset")).toHaveValue("aichi");
});

test("presets: the selector is reachable on a phone without horizontal scroll", async ({ page }) => {
  await page.goto("./tier/?preset=additive");
  await expect(page.locator("#preset")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
