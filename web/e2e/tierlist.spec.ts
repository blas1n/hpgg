import { expect, test, type Page } from "@playwright/test";

// Built against web/tests/e2e-data (frozen 2026-09-28 fixtures), see `npm run e2e`.

const tierOf = async (page: Page, slug: string) =>
  page.locator(`details.hero[data-hero="${slug}"]`).getAttribute("data-tier");

test("default view is Quick Match, all maps, no map dropdown; expected tiers", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#meta-line")).toContainText("빠른 대전");
  await expect(page.locator("#mode-qm")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#map-wrap")).toBeHidden();
  expect(await tierOf(page, "illidan")).toBe("B");
  expect(await tierOf(page, "azmodan")).toBe("S");
  expect(await tierOf(page, "brightwing")).toBe("A");
  await expect(page.locator(".ban-row").first()).toBeHidden(); // QM has no bans
});

test("role filter hides other roles but keeps tiers (computed on everyone)", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "치유사" }).click();
  await expect(page).toHaveURL(/role=Healer/);
  const shown = await page.locator("details.hero .en").allTextContents();
  expect(shown).toContain("Brightwing");
  expect(shown).not.toContain("Illidan");
  expect(await tierOf(page, "brightwing")).toBe("A"); // same tier as with all roles
});

test("Storm League: map dropdown appears, tiers change, bans shown", async ({ page }) => {
  await page.goto("./");
  await page.locator("#mode-sl").click();
  await expect(page.locator("#map-wrap")).toBeVisible();
  await expect(page).toHaveURL(/mode=sl/);
  expect(await tierOf(page, "illidan")).toBe("A");
  expect(await tierOf(page, "brightwing")).toBe("F");
  await page.locator('details.hero[data-hero="brightwing"] summary').click();
  await expect(page.locator('details.hero[data-hero="brightwing"] .ban')).toContainText("%");
});

test("selecting one map excludes thin rows from the cut and lists them as grey", async ({ page }) => {
  await page.goto("./?mode=sl");
  await page.locator("#map").selectOption("Cursed Hollow");
  await expect(page).toHaveURL(/map=Cursed\+Hollow|map=Cursed%20Hollow/);
  await expect(page.locator("#meta-line")).toContainText("저주받은 골짜기");
  await expect(page.locator("#grey-wrap")).toBeVisible();
  const greyCount = await page.locator("#grey .chip").count();
  expect(greyCount).toBeGreaterThan(0);
  // a grey hero must not appear in any tier section
  const firstGrey = await page.locator("#grey .chip").first().getAttribute("data-hero");
  await expect(page.locator(`details.hero[data-hero="${firstGrey}"]`)).toHaveCount(0);
});

test("vote is one-shot per hero and mode, and fires a goatcounter event when present", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { goatcounter: unknown }).goatcounter = {
      count: (o: { path: string }) => {
        (window as unknown as { __events: string[] }).__events ??= [];
        (window as unknown as { __events: string[] }).__events.push(o.path);
      },
    };
  });
  await page.goto("./");
  const card = page.locator('details.hero[data-hero="illidan"]');
  await card.locator("summary").click();
  await card.locator('[data-vote="up"]').click();
  await expect(card.locator('[data-vote="up"]')).toHaveAttribute("aria-pressed", "true");
  await expect(card.locator('[data-vote="down"]')).toBeDisabled();
  await card.locator('[data-vote="down"]').click({ force: true });
  const events = await page.evaluate(() => (window as unknown as { __events: string[] }).__events);
  expect(events).toEqual(["vote/qm/illidan/up"]);
  await page.reload();
  await page.locator('details.hero[data-hero="illidan"] summary').click();
  await expect(page.locator('details.hero[data-hero="illidan"] [data-vote="up"]')).toHaveAttribute("aria-pressed", "true");
});

test("?patch=previous shows the banner and previous-patch data; state round-trips through the URL", async ({ page }) => {
  await page.goto("./?patch=previous");
  await expect(page.locator("#patch-banner")).toBeVisible();
  await expect(page.locator("#patch-banner")).toContainText("이전 패치");
  await expect(page.locator("#meta-line")).toContainText("2.55.17.97771");
  await page.goto("./?mode=sl&map=Cursed%20Hollow&role=Tank");
  await expect(page.locator("#mode-sl")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#map")).toHaveValue("Cursed Hollow");
  await expect(page.getByRole("button", { name: "전사" })).toHaveAttribute("aria-pressed", "true");
});

test("no horizontal scroll on a phone and the formula is printed", async ({ page }) => {
  await page.goto("./");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.locator("#formula")).toContainText("픽률 × (승률 − 50) × 3");
  await expect(page.locator("footer")).toContainText("Data provided by");
});
