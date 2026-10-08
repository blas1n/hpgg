import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";

// 전적 검색 against a mocked API (the real one is https://api.hpgg.win, our server in server/).
const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../tests/fixtures/api_player_zemill.json"), "utf-8"));
const games = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../tests/fixtures/api_matches_blas1n.json"), "utf-8"));
const replay = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../tests/fixtures/api_replay_65597227.json"), "utf-8"));
const API = "https://api.hpgg.win/v1/players**";

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
  await page.route("https://www.heroesprofile.com/Upload/Embed**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>stub uploader</p>" }));
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
  expect(seen[0]!.searchParams.get("battletag")).toBe("Zemill#1940");
  expect(seen[0]!.searchParams.get("region")).toBe("NA");
  await expect(page).toHaveURL(/\/ko\/hots\/players\/\?tag=Zemill%231940&region=NA$/);
  await expect(page.locator("#player-name")).toContainText("Zemill#1940");
  await expect(page.locator("#player-modes [data-mode]").first()).toHaveAttribute("data-mode", "sl");
  await expect(page.locator('#player-modes [data-mode="sl"]')).toContainText("다이아몬드 2");
  await expect(page.locator('#player-modes [data-mode="sl"]')).toContainText("2,908");
  await expect(page.locator("#player-matches li")).toHaveCount(5);
  await expect(page.locator("#player-matches li").first()).toHaveAttribute("data-result", "win");
  await expect(page.locator("#player-matches li").first()).toContainText("데커드");
  await expect(page.locator("#player-heroes li").first()).toHaveAttribute("data-hero", "lucio");
  await expect(page.locator("#player-heroes li a").first()).toHaveAttribute("href", "/ko/hots/heroes/lucio/");
  await expect(page.locator("#player-stale")).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("players: a shared link runs the search on load", async ({ page }) => {
  const seen = await mockApi(page, (route) => json(route, 200, fixture));
  await page.goto("./players/?tag=Zemill%231940&region=NA");
  await expect(page.locator("#player-result")).toHaveAttribute("data-state", "ok");
  // one profile call and one game-list call (팀운, when on, asks its own: tests/e2e teamluck.spec.ts)
  expect(seen.map((u) => u.pathname).filter((p) => p !== "/v1/players/teamluck").sort()).toEqual(["/v1/players", "/v1/players/matches"]);
  await expect(page.locator("#player-search-tag")).toHaveValue("Zemill#1940");
  await expect(page.locator("#player-search-region")).toHaveValue("NA");
});

test("players: API not reachable → 준비 중, not a spinner", async ({ page }) => {
  await page.route(API, (r) => r.abort("connectionrefused"));
  await page.goto("./players/?tag=Zemill%231940&region=KR");
  await expect(page.locator("#player-result")).toHaveAttribute("data-state", "offline");
  await expect(page.locator("#player-result")).toContainText("준비 중");
});

test("players: a Cloudflare error page (host not wired yet) is also 준비 중", async ({ page }) => {
  await page.route(API, (r) => r.fulfill({ status: 530, contentType: "text/html", body: "<html>error 1033</html>" }));
  await page.goto("./players/?tag=Zemill%231940&region=KR");
  await expect(page.locator("#player-result")).toHaveAttribute("data-state", "offline");
});

test("players: quota exceeded is said plainly", async ({ page }) => {
  await mockApi(page, (route) => json(route, 429, { error: { code: "quota_exceeded", message: "x" } }, { "retry-after": "3600" }));
  await page.goto("./players/?tag=Zemill%231940&region=KR");
  await expect(page.locator("#player-result")).toHaveAttribute("data-state", "quota");
  await expect(page.locator("#player-result")).toContainText("오늘 조회 한도 초과");
});

test("players: cached profile while the quota is out is shown with a note", async ({ page }) => {
  await mockApi(page, (route) => json(route, 200, { ...fixture, stale: true, notice: "quota_exceeded" }));
  await page.goto("./players/?tag=Zemill%231940&region=NA");
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

test("players: a private profile says so and shows nothing of the player", async ({ page }) => {
  await mockApi(page, (route) => json(route, 403, { error: { code: "player_private" } }));
  await page.goto("./players/?tag=Razhag%232142&region=EU");
  await expect(page.locator("#player-result")).toHaveAttribute("data-state", "private");
  await expect(page.locator("#player-result")).toContainText("비공개");
  await expect(page.locator("#player-matches")).toHaveCount(0);
  await expect(page.locator("#upload-guide")).not.toHaveAttribute("open", ""); // uploading would not help
});

test("players: how records get here is explained up front; not found opens the upload guide", async ({ page }) => {
  await mockApi(page, (route) => json(route, 404, { error: { code: "player_not_found" } }));
  await page.goto("./players/");
  const guide = page.locator("#upload-guide");
  await expect(guide).toBeVisible();
  await expect(guide).not.toHaveAttribute("open", "");
  await expect(guide.locator("summary")).toContainText("공식 전적 API가 없어");
  await page.locator("#player-search-tag").fill("Nobody#1234");
  await page.locator("#player-search-tag").press("Enter");
  await expect(page.locator("#player-result")).toHaveAttribute("data-state", "not_found");
  await expect(guide).toHaveAttribute("open", "");
  await expect(guide.locator('a[href="https://www.heroesprofile.com/Upload"]').first()).toBeVisible();
  await expect(guide).toContainText("문서\\Heroes of the Storm\\Accounts");
  await expect(guide).toContainText("~/Library/Application Support/Blizzard/Heroes of the Storm/Accounts");
  await expect(page.locator("#player-result")).toContainText("아시아"); // the region hint sits in the not-found notice
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
  await page.locator("#home-player-search-tag").fill("Zemill#1940");
  await page.locator("#home-player-search button[type=submit]").click();
  await expect(page).toHaveURL(/\/ko\/hots\/players\/\?tag=Zemill%231940&region=NA$/);
  await expect(page.locator("#player-result")).toHaveAttribute("data-state", "ok");
});

// Heroes Profile's embeddable uploader replaces CORS (HP 2026-09-29): an iframe with ?source=hpgg; the page listens to
// its messages (only from https://www.heroesprofile.com) for its height and the end of the queue.
const WIDGET_STUB = `<!doctype html><p>stub uploader</p><script>
  parent.postMessage({ type: "heroesprofile:resize", height: 700 }, "*");
  parent.postMessage({ type: "heroesprofile:upload", file: "a.StormReplay", status: "Success", replayID: 1 }, "*");
  parent.postMessage({ type: "heroesprofile:upload-complete", uploaded: 2, duplicates: 1, failed: 0 }, "*");
</script>`;

test("players: the upload guide embeds Heroes Profile's uploader and says when to search again", async ({ page }) => {
  await page.route("https://www.heroesprofile.com/Upload/Embed**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: WIDGET_STUB }));
  await page.goto("./players/");
  // a forged message from our own origin is ignored
  await page.evaluate(() => window.postMessage({ type: "heroesprofile:upload-complete", uploaded: 99, duplicates: 0, failed: 0 }, "*"));
  await page.locator("#upload-guide summary").click();
  const frame = page.locator("#hp-uploader");
  await expect(frame).toHaveAttribute("src", "https://www.heroesprofile.com/Upload/Embed?source=hpgg");
  await expect(frame).toHaveAttribute("title", /Heroes Profile/);
  await expect(frame).toHaveCSS("height", "700px");
  const done = page.locator("#upload-done");
  await expect(done).toContainText("3"); // 2 uploaded + 1 already there
  await expect(done).toContainText("다시 검색");
  await expect(done).not.toContainText("99");
  await expect(page.locator("#upload-guide")).toContainText("문서\\Heroes of the Storm\\Accounts"); // the folder to pick stays
});

test("players: not found leads straight to uploading, and the funnel is counted (owner 10-03: 31 % found nobody)", async ({ page }) => {
  await page.route("https://www.heroesprofile.com/Upload/Embed**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: WIDGET_STUB }));
  // GoatCounter is blocked in tests: record what the page would send
  await page.addInitScript(() => {
    const w = window as unknown as { goatcounter: { count: (v: { path: string }) => void }; __events: string[] };
    w.__events = [];
    w.goatcounter = { count: (v) => w.__events.push(v.path) };
  });
  await mockApi(page, (route) => json(route, 404, { error: { code: "player_not_found" } }));
  await page.goto("./players/?tag=Nobody%231234&region=KR");
  const result = page.locator("#player-result");
  await expect(result).toHaveAttribute("data-state", "not_found");
  // what uploading gives, in the notice itself
  await expect(result).toContainText("내 전적이 검색되고");
  const cta = result.getByRole("button", { name: "리플레이 올리기" });
  await cta.click();
  await expect(page.locator("#hp-uploader")).toBeInViewport();
  // in the guide, the uploader (games so far) comes before the installer (games from now on)
  const titles = await page.locator("#upload-guide h3").allTextContents();
  expect(titles[0]).toContain("지금까지의 경기");
  await expect(page.locator("#upload-done")).toBeVisible(); // the stub finishes its queue
  // the stub finishes as soon as it loads (the guide is already open), so the order is not the visitor's
  const events = await page.evaluate(() => (window as unknown as { __events: string[] }).__events);
  expect([...events].sort()).toEqual(["upload-complete", "upload-cta"]);
});

const withGames = (body: unknown) => (route: Route, url: URL) => json(route, 200, url.pathname.endsWith("/matches") ? body : fixture);

test("players: the newest 20 games — briefing, MMR line, stat lines and talents; more on request", async ({ page }) => {
  await mockApi(page, withGames(games));
  await page.goto("./players/?tag=blAs1N%233479&region=KR");
  await expect(page.locator("#player-games")).toHaveAttribute("data-source", "full");
  await expect(page.locator("#brief-record")).toHaveText("9승 11패");
  await expect(page.locator("#brief-kda")).toContainText("4.17");
  await expect(page.locator("#brief-avg")).toContainText("영웅 피해");
  await expect(page.locator("#brief-heroes li").first()).toContainText("알라라크");
  await expect(page.locator('#brief-roles [data-role="Melee Assassin"]')).toContainText("10");
  await expect(page.locator("#brief-mmr circle")).toHaveCount(25);
  const first = page.locator("#player-matches > li").first();
  await expect(page.locator("#player-matches > li")).toHaveCount(20);
  await expect(first).toHaveAttribute("data-result", "win");
  await expect(first.locator("[data-kda]")).toContainText("9 / 1 / 25");
  await expect(first.locator("[data-stats]")).toContainText("72,367");
  await expect(first.locator("[data-mmr]")).toHaveText("+43.1");
  await expect(first.locator("[data-talents] li")).toHaveCount(7);
  await page.locator("#games-more").click();
  await expect(page.locator("#player-matches > li")).toHaveCount(25);
  await expect(page.locator("#games-more")).toHaveCount(0);
});

test("players: hovering the MMR line reads out that game", async ({ page }) => {
  await mockApi(page, withGames(games));
  await page.goto("./players/?tag=blAs1N%233479&region=KR");
  const chart = page.locator("#brief-mmr svg");
  const box = (await chart.boundingBox())!;
  await chart.hover({ position: { x: box.width - 3, y: box.height / 2 } }); // the newest game sits at the right end
  await expect(page.locator('#brief-mmr [role="status"]')).toContainText("2342");
});

test("players: past the detailed budget the games come without stat lines, and the page says so", async ({ page }) => {
  const basic = { ...games, source: "basic", matches: games.matches.map((m: Record<string, unknown>) => ({ ...m, kills: null, deaths: null, assists: null, talents: [] })) };
  await mockApi(page, withGames(basic));
  await page.goto("./players/?tag=blAs1N%233479&region=KR");
  await expect(page.locator("#games-basic")).toHaveAttribute("data-reason", "slow");
  await expect(page.locator("#games-basic")).toContainText("잠시 뒤 다시");
  await expect(page.locator("#brief-kda")).toHaveCount(0);
  await expect(page.locator("#player-matches > li").first().locator("[data-kda]")).toHaveCount(0);
  await expect(page.locator("#brief-mmr circle")).toHaveCount(25);
});

test("players: when the game list fails, the profile's five newest games stay", async ({ page }) => {
  await mockApi(page, (route, url) => (url.pathname.endsWith("/matches") ? json(route, 503, { error: { code: "upstream_unavailable" } }) : json(route, 200, fixture)));
  await page.goto("./players/?tag=Zemill%231940&region=NA");
  await expect(page.locator("#player-result")).toHaveAttribute("data-state", "ok");
  await expect(page.locator("#player-games")).toHaveCount(0);
  await expect(page.locator("#player-matches li")).toHaveCount(5);
});

test("players: a game card shows its award and opens both teams in full", async ({ page }) => {
  await mockApi(page, withGames(games));
  const asked: string[] = [];
  await page.route("https://api.hpgg.win/v1/replays/**", (route) => {
    asked.push(new URL(route.request().url()).pathname);
    return json(route, 200, replay);
  });
  await page.goto("./players/?tag=blAs1N%233479&region=KR");
  const first = page.locator("#player-matches > li").first();
  await expect(first.locator('[data-award="MVP"]')).toContainText("MVP");
  await expect(page.locator("#player-matches > li").nth(1).locator("[data-award]")).toHaveCount(0);
  expect(asked).toEqual([]); // nothing is fetched until a game is opened
  const toggle = first.locator("[data-toggle]");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const panel = first.locator("[data-replay]");
  await expect(panel.locator("table")).toHaveCount(2);
  await expect(panel.locator("table").first()).toHaveAttribute("data-team", "win");
  await expect(panel).toContainText("경기 시간 20:15");
  const me = panel.locator("tr[data-me]");
  await expect(me).toHaveCount(1);
  await expect(me).toContainText("blAs1N");
  await expect(me.locator('[data-award="MVP"]')).toHaveCount(1);
  await expect(panel.locator('[data-award="MostDamageTaken"]')).toHaveCount(1);
  await expect(panel.locator("[data-party]")).toHaveCount(2);
  await expect(panel.locator('a[href*="tag=Tusk%2331987&region=KR"]')).toHaveCount(1);
  expect(asked).toEqual(["/v1/replays/65597227"]);
  await toggle.click();
  await expect(first.locator("[data-replay]")).toHaveCount(0);
});

test("players: a game that cannot be opened says why", async ({ page }) => {
  await mockApi(page, withGames(games));
  await page.route("https://api.hpgg.win/v1/replays/**", (route) => json(route, 429, { error: { code: "quota_exceeded" } }));
  await page.goto("./players/?tag=blAs1N%233479&region=KR");
  const first = page.locator("#player-matches > li").first();
  await first.locator("[data-toggle]").click();
  await expect(first).toContainText("경기 상세 조회 한도");
});


test("players: stats per hero come from the match list, per mode, asking Heroes Profile nothing more", async ({ page }) => {
  // owner 2026-10-09: /players/heroes spent a 500-a-week bucket; the newest games already carry hero, result and stats
  const mixed = { ...games, matches: games.matches.map((m: Record<string, unknown>, i: number) => (i < 2 ? { ...m, mode: "sl" } : m)) };
  const seen = await mockApi(page, withGames(mixed));
  await page.goto("./players/?tag=blAs1N%233479&region=KR");
  const box = page.locator("#hero-stats");
  await expect(box).toHaveAttribute("data-state", "ok");
  await expect(page.locator("#h-hero-stats + p")).toContainText("최근 25경기");
  const first = box.locator("tbody tr").first();
  await expect(first).toHaveAttribute("data-hero", "alarak");
  await expect(first).toContainText("알라라크");
  await expect(box.locator('tbody tr a[href="/ko/hots/heroes/alarak/"]')).toHaveCount(1);
  const all = await box.locator("tbody tr").count();
  await page.locator("#hero-stats-sl").click();
  await expect(box.locator("tbody tr")).not.toHaveCount(all);
  await page.locator("#hero-stats-qm").click();
  await page.locator("#hero-stats-all").click();
  await expect(box.locator("tbody tr")).toHaveCount(all);
  expect(seen.filter((u) => u.pathname.endsWith("/heroes"))).toHaveLength(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0); // the wide table scrolls inside its card
});

test("players: past the detailed budget the per-hero table keeps games and win rate", async ({ page }) => {
  const basic = { ...games, source: "basic", matches: games.matches.map((m: Record<string, unknown>) => ({ ...m, kills: null, deaths: null, assists: null, hero_damage: null, siege_damage: null, healing: null, damage_taken: null, experience: null, talents: [] })) };
  await mockApi(page, withGames(basic));
  await page.goto("./players/?tag=blAs1N%233479&region=KR");
  const box = page.locator("#hero-stats");
  await expect(box).toHaveAttribute("data-source", "basic");
  await expect(box).toContainText("판수와 승률만");
  await expect(box.locator("tbody tr").first()).toContainText("%");
  await expect(box.locator("tbody tr").first()).toContainText("–");
});

test("players: a list cut short by the quota says when the detailed one returns", async ({ page }) => {
  const at = new Date(Date.now() + 3 * 3600_000);
  const basic = { ...games, source: "basic", full_after: at.toISOString(), matches: games.matches.map((m: Record<string, unknown>) => ({ ...m, kills: null, deaths: null, assists: null, talents: [] })) };
  await mockApi(page, withGames(basic));
  await page.goto("./players/?tag=blAs1N%233479&region=KR");
  const note = page.locator("#games-basic");
  await expect(note).toHaveAttribute("data-reason", "quota");
  await expect(note).toContainText("간단 전적");
  const hhmm = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  await expect(note).toContainText(`${hhmm}쯤부터`);
});
