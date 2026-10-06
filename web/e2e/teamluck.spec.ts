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

// 몇인분's yardstick for the test: every hero's usual per minute is the same, so a game's 몇인분 follows its stats
const per = { td: 0.5, dmg: 2000, siege: 2000, xp: 500, sus: 2000, cc: 1, prot: 0, map: 0.1, dead: 3 };
const yardstick = { heroes: {}, roles: { Tank: { games: 999, per_min: per }, "Ranged Assassin": { games: 999, per_min: per } }, all: per };
const player = (me: boolean, x = 1) => ({
  hero: "Valla",
  role: "Ranged Assassin",
  me,
  stats: {
    takedowns: 5 * x,
    hero_damage: 20000 * x,
    siege_damage: 20000 * x,
    experience: 5000,
    healing: 10000,
    damage_taken: 10000,
    stuns: 10,
    roots: 0,
    silences: 0,
    shields: 0,
    merc_camps: 1,
    towers: 0,
    time_spent_dead: 30,
  },
});
// a 10-minute game; `x` scales the player's takedowns and damage against four teammates at the usual
const team = (x: number) => [player(true, x), player(false), player(false), player(false), player(false)];
const game = (id: number, hero: string, win: boolean, gap: number, x = 1) => ({
  replay_id: id,
  date: "2026-10-05 12:00:00",
  mode: "sl",
  hero,
  win,
  team_mmr: 2300 + gap,
  opp_mmr: 2300,
  gap,
  length_s: 600,
  team: team(x),
});
const luck = {
  mode: "all",
  // the newest two games of the match list fixture: a big game in a win, a light one in a loss
  games: [game(65597227, "Illidan", true, 120, 2.5), game(65597225, "Illidan", false, -90, 0.2), game(1, "Valla", true, 10)],
  summary: { games: 3, gap_avg: 13.3, good: { games: 1, wins: 1 }, bad: { games: 1, wins: 0 }, even: { games: 1, wins: 1 } },
  partial: false,
  formula: { gap: "…", good: 50 },
};

test.beforeEach(async ({ page }) => {
  await page.route("**/carry_baselines.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(yardstick) }));
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
  // 몇인분 on each game the same replays cover — once it is on (FEATURES.carry)
  if (!FEATURES.carry) {
    await expect(page.locator("#player-matches > li [data-carry]")).toHaveCount(0);
    return;
  }
  await expect(page.locator("#player-matches > li").nth(0).locator("[data-carry]")).toHaveText(/^\d\.\d인분$/);
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
