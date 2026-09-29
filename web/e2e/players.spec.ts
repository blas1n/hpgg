import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";

// 전적 검색 against a mocked API (the real one is https://api.hpgg.win, our server in server/).
const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../tests/fixtures/api_player_zemill.json"), "utf-8"));
const API = "https://api.hpgg.win/v1/players**";

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
});

const json = (route: Route, status: number, body: unknown, headers: Record<string, string> = {}) =>
  route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", ...headers }, body: JSON.stringify(body) });

async function mockApi(page: Page, handler: (route: Route, url: URL) => Promise<void>) {
  const seen: URL[] = [];
  await page.route(API, async (route) => {
    const url = new URL(route.request().url());
    seen.push(url);
    await handler(route, url);
  });
  return seen;
}

test("players: empty page explains what to type; nav marks 전적 검색", async ({ page }) => {
  await page.goto("./players/");
  await expect(page.locator("h1")).toHaveText("전적 검색");
  await expect(page.locator("#player-result")).toHaveAttribute("data-state", "idle");
  await expect(page.locator('nav a[aria-current="page"]:visible')).toHaveText("전적 검색");
});

test("players: search shows league per mode, recent matches and heroes; the URL carries the query", async ({ page }) => {
  const seen = await mockApi(page, (route) => json(route, 200, fixture));
  await page.goto("./players/");
  await page.locator("#player-search-region").selectOption("NA");
  await page.locator("#player-search-tag").fill(" Zemill ＃1940 ");
  await page.locator("#player-search-tag").press("Enter");
  await expect(page.locator("#player-result")).toHaveAttribute("data-state", "ok");
  expect(seen[0]!.searchParams.get("battletag")).toBe("Player12#1012");
  expect(seen[0]!.searchParams.get("region")).toBe("NA");
  await expect(page).toHaveURL(/\/hots\/players\/\?tag=Player12%231012&region=NA$/);
  await expect(page.locator("#player-name")).toContainText("Player12#1012");
  await expect(page.locator("#player-modes [data-mode]").first()).toHaveAttribute("data-mode", "sl");
  await expect(page.locator('#player-modes [data-mode="sl"]')).toContainText("다이아몬드 2");
  await expect(page.locator('#player-modes [data-mode="sl"]')).toContainText("2,908");
  await expect(page.locator("#player-matches li")).toHaveCount(5);
  await expect(page.locator("#player-matches li").first()).toHaveAttribute("data-result", "win");
  await expect(page.locator("#player-matches li").first()).toContainText("데커드");
  await expect(page.locator("#player-heroes li").first()).toHaveAttribute("data-hero", "lucio");
  await expect(page.locator("#player-heroes li a").first()).toHaveAttribute("href", "/hots/heroes/lucio/");
  await expect(page.locator("#player-stale")).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("players: a shared link runs the search on load", async ({ page }) => {
  const seen = await mockApi(page, (route) => json(route, 200, fixture));
  await page.goto("./players/?tag=Player12%231012&region=NA");
  await expect(page.locator("#player-result")).toHaveAttribute("data-state", "ok");
  expect(seen).toHaveLength(1);
  await expect(page.locator("#player-search-tag")).toHaveValue("Player12#1012");
  await expect(page.locator("#player-search-region")).toHaveValue("NA");
});

test("players: API not reachable → 준비 중, not a spinner", async ({ page }) => {
  await page.route(API, (r) => r.abort("connectionrefused"));
  await page.goto("./players/?tag=Player12%231012&region=KR");
  await expect(page.locator("#player-result")).toHaveAttribute("data-state", "offline");
  await expect(page.locator("#player-result")).toContainText("준비 중");
});

test("players: a Cloudflare error page (host not wired yet) is also 준비 중", async ({ page }) => {
  await page.route(API, (r) => r.fulfill({ status: 530, contentType: "text/html", body: "<html>error 1033</html>" }));
  await page.goto("./players/?tag=Player12%231012&region=KR");
  await expect(page.locator("#player-result")).toHaveAttribute("data-state", "offline");
});

test("players: quota exceeded is said plainly", async ({ page }) => {
  await mockApi(page, (route) => json(route, 429, { error: { code: "quota_exceeded", message: "x" } }, { "retry-after": "3600" }));
  await page.goto("./players/?tag=Player12%231012&region=KR");
  await expect(page.locator("#player-result")).toHaveAttribute("data-state", "quota");
  await expect(page.locator("#player-result")).toContainText("오늘 조회 한도 초과");
});

test("players: cached profile while the quota is out is shown with a note", async ({ page }) => {
  await mockApi(page, (route) => json(route, 200, { ...fixture, stale: true, notice: "quota_exceeded" }));
  await page.goto("./players/?tag=Player12%231012&region=NA");
  await expect(page.locator("#player-stale")).toContainText("오늘 조회 한도 초과");
  await expect(page.locator("#player-matches li")).toHaveCount(5);
});

test("players: unknown player and upstream trouble", async ({ page }) => {
  let status = 404;
  await mockApi(page, (route) => json(route, status, { error: { code: status === 404 ? "player_not_found" : "upstream_unavailable" } }));
  await page.goto("./players/?tag=Nobody%231234&region=KR");
  await expect(page.locator("#player-result")).toHaveAttribute("data-state", "not_found");
  status = 503;
  await page.locator("#player-search-tag").fill("Other#1234");
  await page.locator("#player-search button[type=submit]").click();
  await expect(page.locator("#player-result")).toHaveAttribute("data-state", "error");
  await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
});

test("players: a malformed BattleTag is caught before any request", async ({ page }) => {
  const seen = await mockApi(page, (route) => json(route, 200, fixture));
  await page.goto("./players/");
  await page.locator("#player-search-tag").fill("Zemill");
  await page.locator("#player-search-tag").press("Enter");
  await expect(page.locator("#player-search-error")).toContainText("이름#1234");
  expect(seen).toHaveLength(0);
  await expect(page.locator("#player-result")).toHaveAttribute("data-state", "idle");
});

test("home: the search box at the top opens 전적 검색 with the query", async ({ page }) => {
  await mockApi(page, (route) => json(route, 200, fixture));
  await page.goto("./");
  await page.locator("#home-player-search-region").selectOption("NA");
  await page.locator("#home-player-search-tag").fill("Player12#1012");
  await page.locator("#home-player-search button[type=submit]").click();
  await expect(page).toHaveURL(/\/hots\/players\/\?tag=Player12%231012&region=NA$/);
  await expect(page.locator("#player-result")).toHaveAttribute("data-state", "ok");
});
