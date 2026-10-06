import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Route } from "@playwright/test";
import { FEATURES } from "../src/features";

// 팀운 on 전적 검색 (#90) against a mocked API: built 2026-10-06, off on the live site until the owner turns it on.
test.skip(!FEATURES.teamluck, "팀운 is switched off (src/features.ts)");

const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../tests/fixtures/api_player_zemill.json"), "utf-8"));
const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });

const game = (id: number, hero: string, win: boolean, gap: number) => ({
  replay_id: id,
  date: "2026-10-05 12:00:00",
  mode: "sl",
  hero,
  win,
  team_mmr: 2300 + gap,
  opp_mmr: 2300,
  gap,
});
const luck = {
  mode: "all",
  games: [game(3, "Qhira", true, 120), game(2, "Illidan", false, -90), game(1, "Valla", true, 10)],
  summary: { games: 3, gap_avg: 13.3, good: { games: 1, wins: 1 }, bad: { games: 1, wins: 0 }, even: { games: 1, wins: 1 } },
  partial: false,
  formula: { gap: "…", good: 50 },
};

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
  await page.route("https://www.heroesprofile.com/Upload/Embed**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>stub</p>" }));
});

test("팀운 is asked only when its card is in view, and reads the gap per game", async ({ page }) => {
  const asked: URL[] = [];
  await page.route("https://api.hpgg.win/v1/players**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/players/teamluck") {
      asked.push(url);
      return json(route, 200, luck);
    }
    return json(route, 200, fixture);
  });
  await page.goto("./players/?tag=Zemill%231940&region=NA");
  await expect(page.locator("#player-result")).toHaveAttribute("data-state", "ok");
  await page.locator("#h-team-luck").scrollIntoViewIfNeeded();
  await expect(page.locator("#team-luck")).toHaveAttribute("data-state", "ok");
  expect(asked[0]!.searchParams.get("mode")).toBe("all");
  expect(asked[0]!.searchParams.get("games")).toBe("20");
  await expect(page.locator("#team-luck-gap")).toHaveText("+13");
  await expect(page.locator("#team-luck-gap")).toHaveAttribute("data-verdict", "even");
  await expect(page.locator("#team-luck-games li")).toHaveCount(3);
  await expect(page.locator("#team-luck-games li").first()).toContainText("키히라");
  await expect(page.locator("#team-luck-games li").first()).toContainText("+120");
  await expect(page.locator('[data-luck="good"]')).toContainText("1판 · 승률 100%");
});

test("팀운: a spent allowance says so", async ({ page }) => {
  await page.route("https://api.hpgg.win/v1/players**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/players/teamluck") return json(route, 429, { error: { code: "quota_exceeded" } });
    return json(route, 200, fixture);
  });
  await page.goto("./players/?tag=Zemill%231940&region=NA");
  await page.locator("#h-team-luck").scrollIntoViewIfNeeded();
  await expect(page.locator("#team-luck")).toHaveAttribute("data-state", "quota");
});
