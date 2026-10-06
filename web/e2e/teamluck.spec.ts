import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Route } from "@playwright/test";
import { FEATURES } from "../src/features";

// 팀운 on 전적 검색 (#90) against a mocked API: built 2026-10-06, off on the live site until the owner turns it on.
test.skip(!FEATURES.teamluck, "팀운 is switched off (src/features.ts)");

const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../tests/fixtures/api_player_zemill.json"), "utf-8"));
const matches = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../tests/fixtures/api_matches_blas1n.json"), "utf-8"));
const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });

const game = (id: number, hero: string, win: boolean, gap: number, carry: number | null = null) => ({
  replay_id: id,
  date: "2026-10-05 12:00:00",
  mode: "sl",
  hero,
  win,
  team_mmr: 2300 + gap,
  opp_mmr: 2300,
  gap,
  carry,
});
const luck = {
  mode: "all",
  // the newest two games of the match list fixture: a carry in a win, a light game in a loss
  games: [game(65597227, "Illidan", true, 120, 1.6), game(65597225, "Illidan", false, -90, 0.6), game(1, "Valla", true, 10)],
  summary: { games: 3, gap_avg: 13.3, good: { games: 1, wins: 1 }, bad: { games: 1, wins: 0 }, even: { games: 1, wins: 1 } },
  partial: false,
  formula: { gap: "…", good: 50 },
};

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
  await page.route("https://www.heroesprofile.com/Upload/Embed**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>stub</p>" }));
});

test("팀운 is one line in the 최근 20경기 panel: a grade, no numbers", async ({ page }) => {
  const asked: URL[] = [];
  await page.route("https://api.hpgg.win/v1/players**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/players/teamluck") {
      asked.push(url);
      return json(route, 200, luck);
    }
    return json(route, 200, url.pathname === "/v1/players/matches" ? matches : fixture);
  });
  await page.goto("./players/?tag=Zemill%231940&region=NA");
  await expect(page.locator("#player-result")).toHaveAttribute("data-state", "ok");
  await expect(page.locator("#brief-luck")).toHaveAttribute("data-luck", "normal"); // mean gap +13.3
  await expect(page.locator("#brief-luck")).toContainText("팀운");
  await expect(page.locator("#brief-luck")).toContainText("보통");
  // 몇인분 on each game the same replays cover
  await expect(page.locator("#player-matches > li").nth(0).locator("[data-carry]")).toHaveText("1.6인분");
  await expect(page.locator("#player-matches > li").nth(0).locator("[data-carry]")).toHaveAttribute("data-carry", "carry");
  await expect(page.locator("#player-matches > li").nth(1).locator("[data-carry]")).toHaveAttribute("data-carry", "light");
  await expect(page.locator("#player-matches > li").nth(2).locator("[data-carry]")).toHaveCount(0);
  expect(asked[0]!.searchParams.get("mode")).toBe("all");
  expect(asked[0]!.searchParams.get("games")).toBe("20");
});

test("팀운: a spent allowance leaves the line out", async ({ page }) => {
  await page.route("https://api.hpgg.win/v1/players**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/players/teamluck") return json(route, 429, { error: { code: "quota_exceeded" } });
    return json(route, 200, url.pathname === "/v1/players/matches" ? matches : fixture);
  });
  await page.goto("./players/?tag=Zemill%231940&region=NA");
  await expect(page.locator("#brief-avg")).toBeVisible();
  await expect(page.locator("#brief-luck")).toHaveCount(0);
});
