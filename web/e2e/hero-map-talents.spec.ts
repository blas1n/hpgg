import { expect, test, type Page } from "@playwright/test";
import { FEATURES } from "../src/features";
import { lowContrast } from "./contrast";

// 전장별 특성 (owner 2026-11-05): on the hero page a map in the talent section swaps the builds for that map's whole
// talent tree, from our API (/v1/heroes/talents → Heroes Profile, kept a week). The first visitor of a hero, map and
// bracket waits ~2 s: the builds stay on screen until the tree comes, and stay when it does not.
test.skip(!FEATURES.mapTalents, "전장별 특성 is switched off (src/features.ts)");

const API = "https://api.hpgg.win/v1/heroes/talents**";
const ORIGIN = `http://localhost:${process.env.E2E_PORT ?? 4173}`;
const row = (talent: string, games: number, win_rate: number) => ({ talent, games, wins: Math.round((games * win_rate) / 100), popularity: 0, win_rate });
const TREE = {
  "1": [row("IllidanUnendingHatredPassive", 900, 51.2), row("IllidanReflexiveBlock", 100, 47.0)],
  "4": [row("IllidanCombatStyleHuntersOnslaught", 600, 52.5), row("IllidanSweepingStrikesThirstingBlade", 380, 49.1), row("IllidanMasteryImmolationSweepingStrike", 20, 40)],
  "7": [row("IllidanMasteryUnboundSweepingStrike", 1000, 50.0)],
  "10": [row("IllidanHeroicAbilityTheHunt", 1000, 50.0)],
  "13": [row("IllidanNimbleDefender", 1000, 50.0)],
  "16": [row("IllidanBladesOfAzzinoth", 1000, 50.0)],
  "20": [row("GenericTalentNexusBlades", 1000, 50.0)],
};

type Asked = Record<string, string>;
async function mockTalents(page: Page, { status = 200, delay = 0 }: { status?: number; delay?: number } = {}): Promise<Asked[]> {
  const asked: Asked[] = [];
  await page.route(API, async (route) => {
    const q = Object.fromEntries(new URL(route.request().url()).searchParams);
    asked.push(q);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const headers = { "access-control-allow-origin": ORIGIN };
    if (status !== 200) {
      return route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify({ error: { code: status === 429 ? "quota_exceeded" : "upstream_unavailable", message: "" } }) });
    }
    const body = { hero: q.hero, map: q.map, tier: q.tier, patch: q.patch, builds: "2.55.17.98025", levels: TREE, fetched_at: "2026-11-05T09:00:00Z", stale: false, notice: null };
    return route.fulfill({ status: 200, contentType: "application/json", headers, body: JSON.stringify(body) });
  });
  return asked;
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
});

test("a map: the builds stay while it loads, then that map's tree replaces them; the address keeps the map", async ({ page }) => {
  const asked = await mockTalents(page, { delay: 800 });
  await page.goto("./heroes/illidan/?mode=sl&tier=high");
  await expect(page.locator("#builds [data-build]").first()).toBeVisible();
  await page.locator("#builds-map").selectOption("battlefield-of-eternity");
  // picking a map at once keeps the view the address gave (Storm League, 다마그)
  await expect(page).toHaveURL(/mode=sl&tier=high&map=battlefield-of-eternity/);
  await expect(page.locator("#hero-bracket")).toHaveValue("high");
  await expect(page.locator("#builds-map-status")).toContainText("불러오는 중");
  await expect(page.locator("#builds [data-build]").first()).toBeVisible(); // not a blank while it loads
  const tree = page.locator("#map-talents");
  await expect(tree).toBeVisible();
  await expect(page.locator("#builds")).toHaveCount(0);
  await expect(page.locator("#builds-map-status")).toHaveCount(0);
  expect(asked).toEqual([{ hero: "Illidan", map: "Battlefield of Eternity", tier: "high", patch: "2.55.17" }]);
  // seven levels, each talent with its pick share of the level and win rate, most picked first
  await expect(tree.locator("[data-level]")).toHaveCount(7);
  const four = tree.locator('[data-level="4"] [data-talent]');
  await expect(four).toHaveCount(3);
  await expect(four.nth(0)).toContainText("사냥꾼의 맹습");
  await expect(four.nth(0)).toContainText("60.0%");
  await expect(four.nth(0)).toContainText("52.5%");
  // under 30 games: listed, its win rate muted like a thin build's
  await expect(four.nth(2)).toHaveAttribute("data-thin", "true");
  await expect(page.locator("#builds-sub")).toContainText("영원의 전쟁터");
  await expect(page).toHaveURL(/map=battlefield-of-eternity/);
  // back to every map: the builds again, the map leaves the address
  await page.locator("#builds-map").selectOption("");
  await expect(page.locator("#builds [data-build]").first()).toBeVisible();
  await expect(tree).toHaveCount(0);
  await expect(page).not.toHaveURL(/map=/);
  await expect(page).toHaveURL(/mode=sl&tier=high/);
});

test("the bracket filter carries over, and a shared link opens on the map's tree", async ({ page }) => {
  const asked = await mockTalents(page);
  await page.goto("./heroes/illidan/?mode=sl&tier=high&map=sky-temple");
  await expect(page.locator("#map-talents")).toBeVisible();
  await expect(page.locator("#builds-map")).toHaveValue("sky-temple");
  expect(asked).toEqual([{ hero: "Illidan", map: "Sky Temple", tier: "high", patch: "2.55.17" }]);
  // the bracket changes: the tree is asked again for it
  await page.locator("#hero-bracket").selectOption("low");
  await expect.poll(() => asked.length).toBe(2);
  expect(asked[1]).toMatchObject({ map: "Sky Temple", tier: "low" });
});

test("a spent budget or a server that does not answer: the builds stay, and it says why", async ({ page }) => {
  await mockTalents(page, { status: 429 });
  await page.goto("./heroes/illidan/?mode=sl&map=dragon-shire");
  await expect(page.locator("#builds-map-status")).toContainText("오늘");
  await expect(page.locator("#builds [data-build]").first()).toBeVisible();
  await expect(page.locator("#map-talents")).toHaveCount(0);
  await page.unrouteAll();
  await mockTalents(page, { status: 503 });
  await page.locator("#builds-map").selectOption("cursed-hollow");
  await expect(page.locator("#builds-map-status")).toContainText("불러오지 못해");
  await expect(page.locator("#builds [data-build]").first()).toBeVisible();
});

for (const width of [390, 1280]) {
  for (const theme of ["dark", "light"] as const) {
    test(`전장별 특성 at ${width}px, ${theme}: no horizontal scroll, all text reaches WCAG AA (ko and en)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      if (theme === "light") await page.addInitScript(() => localStorage.setItem("hpgg-theme", "light"));
      await mockTalents(page);
      for (const base of ["./heroes/illidan/", "/en/hots/heroes/illidan/"]) {
        await page.goto(`${base}?mode=sl&map=battlefield-of-eternity`);
        await expect(page.locator("#map-talents [data-talent]").first()).toBeVisible();
        expect(await noHorizontalScroll(page)).toBe(true);
        const { fails, measured } = await lowContrast(page);
        expect(measured).toBeGreaterThan(20);
        expect(fails, `${base} ${theme} ${width}`).toEqual([]);
      }
    });
  }
}
