import { expect, test, type Page } from "@playwright/test";
import { FEATURES } from "../src/features";
import { lowContrast } from "./contrast";

// 내 영웅풀 on the 밴픽 page (#28, stage D): members keep a list of the heroes they play — by hand or from this season's
// record — and can have our pick suggestions drawn from it. Switched off with the rest of the accounts (src/features.ts).
test.skip(!FEATURES.accounts, "accounts are switched off (src/features.ts)");

// the site and the API are different origins and the cookie rides along: the exact origin, credentials allowed
const ORIGIN = `http://localhost:${process.env.E2E_PORT ?? 4173}`;
type Me = { battletag: string; region: "KR" | "NA" | "EU" | null };
type Call = { method: string; path: string; body: unknown };
type Sync = { status: string; stale?: boolean; record?: [string, number, number][] };

const RECORD: [string, number, number][] = [["Valla", 31, 17], ["Li Li", 12, 7], ["Lúcio", 5, 2], ["Zeratul", 4, 3], ["Abathur", 1, 0]];

async function mockApi(page: Page, { me, pool = [], sync = { status: "ok", record: RECORD }, failWrites = false }: { me: Me | null; pool?: string[]; sync?: Sync; failWrites?: boolean }) {
  const state = { me, pool: [...pool], sync, failWrites, calls: [] as Call[] };
  await page.route("https://api.hpgg.win/v1/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const headers = {
      "access-control-allow-origin": ORIGIN,
      "access-control-allow-credentials": "true",
      "access-control-allow-methods": "GET, POST, DELETE",
      "access-control-allow-headers": "Content-Type",
      vary: "Origin",
    };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const body = req.postData() ? JSON.parse(req.postData()!) : null;
    state.calls.push({ method: req.method(), path, body });
    const send = (status: number, json?: unknown) =>
      route.fulfill({ status, contentType: "application/json", headers, body: json === undefined ? "" : JSON.stringify(json) });
    if (path === "/v1/me" && req.method() === "GET") return state.me ? send(200, state.me) : send(401, { error: { code: "not_signed_in", message: "" } });
    if (!state.me) return send(401, { error: { code: "not_signed_in", message: "" } });
    if (path === "/v1/me/region") {
      state.me = { ...state.me, region: body.region };
      return send(204);
    }
    if (path === "/v1/me/pool" && req.method() === "GET") return send(200, { heroes: state.pool.map((hero) => ({ hero })) });
    if (path === "/v1/me/pool" && req.method() === "POST") {
      if (state.failWrites) return send(500, { error: { code: "internal", message: "" } });
      if (body.in && !state.pool.includes(body.hero)) state.pool.push(body.hero);
      if (!body.in) state.pool = state.pool.filter((h) => h !== body.hero);
      return send(204);
    }
    if (path === "/v1/me/pool" && req.method() === "DELETE") {
      state.pool = [];
      return send(204);
    }
    if (path === "/v1/me/pool/sync") {
      if (!state.me.region) return send(409, { error: { code: "region_required", message: "" } });
      const { status, stale = false, record = [] } = state.sync;
      const have = new Set(state.pool);
      const rows = status === "ok" ? record : [];
      const added = rows.filter(([h, g]) => g >= 5 && !have.has(h)).map(([h]) => h);
      state.pool.push(...added);
      const candidates = rows.filter(([h, g]) => g > 0 && g < 5 && !have.has(h)).map(([hero, games, wins]) => ({ hero, games, wins }));
      return send(200, { status, stale, season: status === "ok" ? 13 : null, min_games: 5, added, candidates });
    }
    return send(404, { error: { code: "not_found", message: "" } });
  });
  return state;
}

const MEMBER: Me = { battletag: "blAs1N#3479", region: "KR" };
const poolTab = (page: Page) => page.locator("#draft-tab-pool");
const gridHero = (page: Page, slug: string) => page.locator(`#pool-heroes button[data-hero="${slug}"]`);
const chip = (page: Page, slug: string) => page.locator(`#pool-mine [data-hero="${slug}"]`);
const suggested = (page: Page) => page.locator("#draft-suggest button[data-hero]").evaluateAll((els) => els.map((e) => e.getAttribute("data-hero")));
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
});

test("tabs: a member sees 밴픽 and 내 영웅풀 (with the count), the tab is in the address; a guest sees no tabs", async ({ page }) => {
  await mockApi(page, { me: MEMBER, pool: ["Valla", "Li Li"] });
  await page.goto("./draft/");
  await expect(poolTab(page)).toBeVisible();
  await expect(poolTab(page)).toContainText("내 영웅풀");
  await expect(page.locator("#pool-count")).toHaveText("2");
  await expect(page.locator("#draft-tab-draft")).toHaveAttribute("aria-selected", "true");
  await poolTab(page).click();
  await expect(poolTab(page)).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/[?&]tab=pool/);
  await expect(page.locator("#pool-view")).toBeVisible();
  await expect(page.locator("#draft-suggest")).toHaveCount(0);
  // linked straight to the tab
  await page.reload();
  await expect(page.locator("#pool-view")).toBeVisible();
  await page.locator("#draft-tab-draft").click();
  await expect(page).not.toHaveURL(/tab=pool/);
  await expect(page.locator("#draft-suggest")).toBeVisible();

  const guest = await page.context().newPage();
  await mockApi(guest, { me: null });
  await guest.goto("./draft/?tab=pool");
  await expect(guest.locator("#draft-suggest")).toBeVisible();
  await expect(guest.locator("#draft-tab-pool")).toHaveCount(0);
  await expect(guest.locator("#pool-view")).toHaveCount(0);
});

test("manual: the grid toggles a hero in and out, the chips remove it; each change is saved", async ({ page }) => {
  const api = await mockApi(page, { me: MEMBER });
  await page.goto("./draft/?tab=pool");
  await expect(page.locator("#pool-mine")).toContainText("아직 비어 있어요");
  await gridHero(page, "valla").click();
  await expect(gridHero(page, "valla")).toHaveAttribute("aria-pressed", "true");
  await expect(chip(page, "valla")).toContainText("발라");
  await expect(chip(page, "valla")).toContainText("직접");
  await expect(page.locator("#pool-count")).toHaveText("1");
  // the role filter and the 초성 search narrow the grid
  await page.locator('#pool-roles [data-role="Healer"]').click();
  await expect(gridHero(page, "valla")).toHaveCount(0);
  await page.locator("#pool-search").fill("ㄹㄹ");
  await expect(gridHero(page, "li-li")).toBeVisible();
  await gridHero(page, "li-li").click();
  await expect(chip(page, "li-li")).toContainText("리 리");
  // remove from the chip and from the grid
  await chip(page, "valla").locator("button").click();
  await expect(chip(page, "valla")).toHaveCount(0);
  await gridHero(page, "li-li").click();
  await expect(chip(page, "li-li")).toHaveCount(0);
  await expect(page.locator("#pool-count")).toHaveText("0");
  await expect.poll(() => api.calls.filter((c) => c.method === "POST" && c.path === "/v1/me/pool").map((c) => c.body)).toEqual([
    { hero: "Valla", in: true },
    { hero: "Li Li", in: true },
    { hero: "Valla", in: false },
    { hero: "Li Li", in: false },
  ]);
});

test("a failed save is undone and said", async ({ page }) => {
  await mockApi(page, { me: MEMBER, failWrites: true });
  await page.goto("./draft/?tab=pool");
  await gridHero(page, "valla").click();
  await expect(page.locator("#pool-error")).toContainText("저장하지 못했어요");
  await expect(gridHero(page, "valla")).toHaveAttribute("aria-pressed", "false");
  await expect(chip(page, "valla")).toHaveCount(0);
});

test("sync: heroes played 5+ times go in, the rest come back as one-click candidates", async ({ page }) => {
  await mockApi(page, { me: MEMBER });
  await page.goto("./draft/?tab=pool");
  await page.locator("#pool-sync").click();
  const result = page.locator("#pool-result");
  await expect(result).toContainText("3명 넣었어요");
  await expect(result).toContainText("발라, 리 리, 루시우");
  await expect(result).toContainText("5판 이상");
  for (const s of ["valla", "li-li", "lucio"]) await expect(gridHero(page, s)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#pool-count")).toHaveText("3");
  const cand = page.locator('#pool-candidates button[data-hero="zeratul"]');
  await expect(cand).toContainText("제라툴");
  await expect(cand).toContainText("4판");
  await cand.click();
  await expect(chip(page, "zeratul")).toContainText("이번 시즌 4판");
  await expect(page.locator('#pool-candidates button[data-hero="zeratul"]')).toHaveCount(0);
  await expect(page.locator("#pool-count")).toHaveText("4");
  // again: nothing new to add
  await page.locator("#pool-sync").click();
  await expect(result).toContainText("새로 넣을 영웅이 없어요");
});

test("sync without a season record: says so, links the upload guide, and changes nothing", async ({ page }) => {
  const api = await mockApi(page, { me: MEMBER, pool: ["Valla"], sync: { status: "not_found" } });
  await page.goto("./draft/?tab=pool");
  await page.locator("#pool-sync").click();
  const result = page.locator("#pool-result");
  await expect(result).toContainText("이번 시즌 경쟁전 기록이 없어요");
  await expect(result.locator("a")).toHaveAttribute("href", "/ko/hots/players/#upload-guide");
  await expect(page.locator("#pool-count")).toHaveText("1");
  expect(api.pool).toEqual(["Valla"]);
});

test("sync when Heroes Profile cannot answer now: try again later", async ({ page }) => {
  await mockApi(page, { me: MEMBER, sync: { status: "quota_exceeded" } });
  await page.goto("./draft/?tab=pool");
  await page.locator("#pool-sync").click();
  await expect(page.locator("#pool-result")).toContainText("잠시 후 다시 시도해 주세요");
});

test("sync without a region: asks for it inline, saves it and fills the pool", async ({ page }) => {
  const api = await mockApi(page, { me: { ...MEMBER, region: null } });
  await page.goto("./draft/?tab=pool");
  // the header's own region prompt opens by itself for a member without a region: close it first
  await expect(page.locator("#account-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#account-panel")).toBeHidden();
  await page.locator("#pool-sync").click();
  const ask = page.locator("#pool-region");
  await expect(ask).toBeVisible();
  await ask.locator('[data-region="KR"]').click();
  await expect(page.locator("#pool-result")).toContainText("3명 넣었어요");
  expect(api.calls.filter((c) => c.path === "/v1/me/region").map((c) => c.body)).toEqual([{ region: "KR" }]);
  expect(api.calls.filter((c) => c.path === "/v1/me/pool/sync")).toHaveLength(2);
  await expect(ask).toHaveCount(0);
});

test("clear asks first, then empties the pool", async ({ page }) => {
  const api = await mockApi(page, { me: MEMBER, pool: ["Valla", "Li Li"] });
  await page.goto("./draft/?tab=pool");
  await page.locator("#pool-clear").click();
  await expect(page.locator("#pool-clear-confirm")).toBeVisible();
  await page.locator("#pool-clear-no").click();
  await expect(page.locator("#pool-clear-confirm")).toHaveCount(0);
  expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);
  await page.locator("#pool-clear").click();
  await page.locator("#pool-clear-yes").click();
  await expect(page.locator("#pool-count")).toHaveText("0");
  await expect(chip(page, "valla")).toHaveCount(0);
  await expect.poll(() => api.calls.filter((c) => c.method === "DELETE" && c.path === "/v1/me/pool").length).toBe(1);
});

test("내 영웅풀만: our pick suggestions only from the pool; bans and the other team's picks untouched; remembered", async ({ page }) => {
  await mockApi(page, { me: MEMBER, pool: ["Valla", "Li Li"] });
  // our first pick after the four bans
  await page.goto("./draft/?d=illidan.zeratul.tracer.genji");
  const sw = page.locator("#draft-only-pool");
  await expect(sw).toHaveAttribute("role", "switch");
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("#draft-suggest button[data-hero]")).toHaveCount(8);
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => suggested(page)).toEqual(expect.arrayContaining(["valla", "li-li"]));
  expect((await suggested(page)).sort()).toEqual(["li-li", "valla"]);
  await expect(page.locator("#draft-pool-note")).toContainText("내 영웅풀 2명");
  // remembered in this browser
  await page.reload();
  await expect(page.locator("#draft-only-pool")).toHaveAttribute("aria-checked", "true");
  expect((await suggested(page)).sort()).toEqual(["li-li", "valla"]);
  // a ban: every hero, as before
  await page.goto("./draft/");
  await expect(page.locator("#draft-suggest-title")).toHaveText("추천 밴");
  await expect(page.locator("#draft-suggest button[data-hero]")).toHaveCount(8);
  // their pick: every hero
  await page.goto("./draft/?d=illidan.zeratul.tracer.genji.abathur");
  await expect(page.locator("#draft-turn")).toHaveText("상대 팀이 선택합니다");
  await expect(page.locator("#draft-suggest button[data-hero]")).toHaveCount(8);
});

test("내 영웅풀만 with an empty pool: an empty state that leads to the 내 영웅풀 tab", async ({ page }) => {
  await mockApi(page, { me: MEMBER });
  await page.addInitScript(() => localStorage.setItem("hpgg-draft-only-pool", "1"));
  await page.goto("./draft/?d=illidan.zeratul.tracer.genji");
  const empty = page.locator("#draft-pool-empty");
  await expect(empty).toContainText("영웅풀이 비어 있어요");
  await expect(page.locator("#draft-suggest button[data-hero]")).toHaveCount(0);
  await empty.locator("button").click();
  await expect(page.locator("#pool-view")).toBeVisible();
  await expect(page).toHaveURL(/tab=pool/);
});

test("a guest sees the suggestions as before, a line to log in, and no switch", async ({ page }) => {
  await mockApi(page, { me: null });
  await page.goto("./draft/?d=illidan.zeratul.tracer.genji");
  await expect(page.locator("#draft-suggest button[data-hero]")).toHaveCount(8);
  await expect(page.locator("#draft-only-pool")).toHaveCount(0);
  const line = page.locator("#draft-pool-login");
  await expect(line).toContainText("로그인하면 내가 하는 영웅 안에서 추천받을 수 있어요");
  const href = new URL((await line.locator("a").getAttribute("href"))!);
  expect(href.origin + href.pathname).toBe("https://api.hpgg.win/v1/auth/battlenet/login");
  expect(href.searchParams.get("next")).toBe("/ko/hots/draft/?d=illidan.zeratul.tracer.genji");
});

for (const width of [390, 1280]) {
  for (const theme of ["dark", "light"] as const) {
    test(`내 영웅풀 at ${width}px, ${theme}: no horizontal scroll, all text reaches WCAG AA (ko and en)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      if (theme === "light") await page.addInitScript(() => localStorage.setItem("hpgg-theme", "light"));
      await mockApi(page, { me: MEMBER });
      for (const base of ["./draft/", "/en/hots/draft/"]) {
        await page.goto(`${base}?tab=pool`);
        await page.locator("#pool-sync").click();
        await expect(page.locator("#pool-candidates button").first()).toBeVisible();
        expect(await noHorizontalScroll(page)).toBe(true);
        const { fails, measured } = await lowContrast(page);
        expect(measured).toBeGreaterThan(20);
        expect(fails, `${base} ${theme} ${width}`).toEqual([]);
        // the draft tab with the switch on
        await page.locator("#draft-tab-draft").click();
        await page.locator("#draft-only-pool").click();
        expect(await noHorizontalScroll(page)).toBe(true);
        expect((await lowContrast(page)).fails, `${base} draft ${theme} ${width}`).toEqual([]);
        await page.locator("#draft-only-pool").click();
        // the next locale starts from an empty pool again
        await page.locator("#draft-tab-pool").click();
        await page.locator("#pool-clear").click();
        await page.locator("#pool-clear-yes").click();
      }
    });
  }
}
