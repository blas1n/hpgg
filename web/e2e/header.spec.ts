import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { navIds } from "../src/features";
import { messages } from "../src/i18n/messages";

// Header design B · 검색 중심 (owner 2026-10-30): row 1 logo · one search box for a hero or a BattleTag · toggles;
// row 2 the section tabs (no 홈 — the logo is home). Phones: logo + toggles, the search at full width, scrolling tabs.

const fixture = JSON.parse(readFileSync(new URL("../tests/fixtures/api_player_zemill.json", import.meta.url), "utf-8"));
const season = JSON.parse(readFileSync(new URL("../tests/fixtures/api_season_blas1n.json", import.meta.url), "utf-8"));

test.use({ timezoneId: "Asia/Seoul" });

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
});

const desktop = (page: Page) => page.setViewportSize({ width: 1280, height: 800 });
const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;
const tabs = (page: Page) => page.locator(`header nav[aria-label="${messages.ko.nav.main}"]:visible`);

test("desktop: tabs in the menu's order under the search row, no 홈 tab, the active one marked", async ({ page }) => {
  await desktop(page);
  await page.goto("./tier/");
  const nav = tabs(page);
  await expect(nav).toHaveCount(1);
  expect(await nav.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("data-page")))).toEqual(navIds());
  await expect(page.locator('header a[data-page="home"]')).toHaveCount(0);
  await expect(nav.locator('a[aria-current="page"]')).toHaveText(messages.ko.nav.tier);
  await expect(nav.locator("a[aria-current]")).toHaveCount(1);
  // row 1: logo left, search in the middle, toggles right; row 2: the tabs, left-aligned under the logo
  const logo = await box(page, `header a[aria-label="${messages.ko.nav.homeLink}"]`);
  const search = await box(page, "#site-search");
  const theme = await box(page, "header #theme-toggle");
  const first = await box(page, `header nav[aria-label="${messages.ko.nav.main}"] a`);
  expect(logo.x).toBeLessThan(search.x);
  expect(search.x + search.width).toBeLessThan(theme.x);
  expect(Math.abs(logo.y + logo.height / 2 - (search.y + search.height / 2))).toBeLessThan(4);
  expect(first.y).toBeGreaterThanOrEqual(search.y + search.height);
  expect(Math.abs(first.x - logo.x)).toBeLessThan(16);
  // --header-h is the whole header, so sticky sub-navigation sits under it
  const header = await box(page, "body > header, header.sticky");
  const h = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")));
  expect(h).toBeCloseTo(header.height, 0);
  await page.goto("./heroes/illidan/");
  await expect(tabs(page).locator('a[aria-current="page"]')).toHaveText(messages.ko.nav.heroes);
});

test("the logo goes home", async ({ page }) => {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("./maps/");
    await page.locator(`header a[aria-label="${messages.ko.nav.homeLink}"]`).click();
    await expect(page).toHaveURL(/\/ko\/hots\/$/);
  }
});

test("search: a hero name opens the hero page", async ({ page }) => {
  await desktop(page);
  await page.goto("./");
  const input = page.locator("#site-search");
  await expect(input).toHaveAttribute("placeholder", messages.ko.search.placeholder);
  await input.fill("일리");
  await expect(page.getByRole("option").first()).toHaveAttribute("data-hero", "illidan");
  await expect(page.locator("[data-player]")).toHaveCount(0);
  await input.press("Enter");
  await expect(page).toHaveURL(/\/ko\/hots\/heroes\/illidan\/$/);
});

test("search: a BattleTag (full-width ＃) offers 전적 on the visitor's region and opens the player page", async ({ page }) => {
  await page.route("https://api.hpgg.win/v1/players**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(new URL(route.request().url()).pathname.endsWith("/season") ? season : fixture) }),
  );
  await desktop(page);
  await page.goto("./tier/");
  const input = page.locator("#site-search");
  await input.fill("Zemill＃1940");
  const opt = page.locator('[role="option"][data-player]');
  await expect(opt).toHaveCount(1);
  await expect(opt).toContainText(`Zemill#1940 · ${messages.ko.players.regions.KR}`);
  await expect(page.getByRole("listbox")).toContainText(messages.ko.search.playerGroup);
  await input.press("Enter");
  await expect(page).toHaveURL(/\/ko\/hots\/players\/\?tag=Zemill%231940&region=KR$/);
  await expect(page.locator("#player-result")).toHaveAttribute("data-state", "ok");
});

test.describe("a visitor in Europe", () => {
  test.use({ timezoneId: "Europe/Berlin" });
  test("the BattleTag option is on their region, as the player search starts", async ({ page }) => {
    await page.route("https://api.hpgg.win/**", (r) => r.abort());
    await page.goto("/en/hots/");
    await page.locator("#site-search").fill("Zemill#1940");
    await expect(page.locator("[data-player]")).toContainText(`Zemill#1940 · ${messages.en.players.regions.EU}`);
    await page.locator("[data-player]").click();
    await expect(page).toHaveURL(/\/en\/hots\/players\/\?tag=Zemill%231940&region=EU$/);
  });
});

test("search: an unfinished BattleTag shows the format hint", async ({ page }) => {
  await page.goto("./");
  await page.locator("#site-search").fill("Zemill#19");
  await expect(page.locator("[data-hint]")).toHaveText(messages.ko.search.tagHint);
  await expect(page.locator("[data-player]")).toHaveCount(0);
});

test("'/' focuses the search", async ({ page }) => {
  await desktop(page);
  await page.goto("./heroes/");
  await expect(async () => {
    await page.locator("body").press("/");
    await expect(page.locator("#site-search")).toBeFocused({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await expect(page.locator("#site-search")).toHaveValue("");
});

test("phone: logo and toggles, then the search at full width, then scrolling tabs; no horizontal page scroll", async ({ page }) => {
  await page.goto("./patches/");
  const logo = await box(page, `header a[aria-label="${messages.ko.nav.homeLink}"]`);
  const theme = await box(page, "header #theme-toggle");
  const search = await box(page, "#site-search");
  const nav = tabs(page);
  await expect(nav).toHaveCount(1);
  const navBox = (await nav.boundingBox())!;
  expect(Math.abs(logo.y - theme.y)).toBeLessThan(8);
  expect(search.y).toBeGreaterThanOrEqual(logo.y + logo.height);
  expect(search.width).toBeGreaterThan(300); // the input itself, inside the full-width box
  expect(navBox.y).toBeGreaterThanOrEqual(search.y + search.height);
  expect(await nav.evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");
  expect(await nav.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("data-page")))).toEqual(navIds());
  await expect(nav.locator('a[aria-current="page"]')).toHaveText(messages.ko.nav.patches);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const header = await box(page, "body > header, header.sticky");
  const h = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")));
  expect(h).toBeCloseTo(header.height, 0);
});

test("English at 1280: the search box is at least 400px wide", async ({ page }) => {
  await desktop(page);
  await page.goto("/en/hots/");
  await expect(page.locator("#site-search")).toHaveAttribute("placeholder", messages.en.search.placeholder);
  const field = page.locator("#site-search").locator("xpath=..");
  expect((await field.boundingBox())!.width).toBeGreaterThanOrEqual(400);
});
