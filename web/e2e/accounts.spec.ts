import { expect, test, type Page } from "@playwright/test";
import { FEATURES } from "../src/features";

// Battle.net sign-in on the site (#28, stage B): the header account control and the privacy policy. Hidden on the live
// site until the members-only hero-pool 밴픽 (src/features.ts); the export then has neither.
test.skip(!FEATURES.accounts, "accounts are switched off (src/features.ts)");

// The site and the API are different origins and the session cookie rides along (credentials: "include"): the browser
// accepts the answer only when it names this exact origin and allows credentials — "*" is refused (see the last test).
const ORIGIN = `http://localhost:${process.env.E2E_PORT ?? 4173}`;
type Me = { battletag: string; region: "KR" | "NA" | "EU" | null };
type Call = { method: string; path: string; body: unknown };

async function mockAccount(page: Page, initial: Me | null, origin = ORIGIN) {
  const state = { me: initial, calls: [] as Call[] };
  await page.route("https://api.hpgg.win/v1/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const headers: Record<string, string> = {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, DELETE",
      "access-control-allow-headers": "Content-Type",
      vary: "Origin",
    };
    if (origin !== "*") headers["access-control-allow-credentials"] = "true";
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const body = req.postData() ? JSON.parse(req.postData()!) : null;
    state.calls.push({ method: req.method(), path, body });
    const send = (status: number, json?: unknown) =>
      route.fulfill({ status, contentType: "application/json", headers, body: json === undefined ? "" : JSON.stringify(json) });
    if (path === "/v1/me" && req.method() === "GET") return state.me ? send(200, state.me) : send(401, { error: { code: "not_signed_in", message: "" } });
    if (path === "/v1/me/region" && state.me) {
      state.me = { ...state.me, region: body.region };
      return send(204);
    }
    if (path === "/v1/auth/logout") {
      state.me = null;
      return send(204);
    }
    if (path === "/v1/me" && req.method() === "DELETE" && state.me) {
      state.me = null;
      return send(204);
    }
    return send(404, { error: { code: "not_found", message: "" } });
  });
  return state;
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
});

for (const width of [390, 1280]) {
  test(`signed out at ${width}px: a login link that comes back to this page`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockAccount(page, null);
    await page.goto("./tier/?mode=sl");
    const login = page.locator("header #account-login");
    await expect(login).toBeVisible();
    await expect(login).toHaveText("로그인");
    const href = new URL((await login.getAttribute("href"))!);
    expect(href.origin + href.pathname).toBe("https://api.hpgg.win/v1/auth/battlenet/login");
    expect(href.searchParams.get("next")).toBe("/ko/hots/tier/?mode=sl");
    await expect(page.locator("header #account-button")).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBe(true);
  });
}

test("signed in: the BattleTag opens a menu with region, my profile, privacy, logout and delete; Escape and outside clicks close it", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockAccount(page, { battletag: "blAs1N#3479", region: "KR" });
  await page.goto("./");
  const button = page.locator("header #account-button");
  await expect(button).toHaveText("blAs1N"); // the name; the whole BattleTag is in its label and atop the menu
  await expect(button).toHaveAttribute("aria-label", /blAs1N#3479/);
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#account-panel")).toBeHidden();
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const panel = page.locator("#account-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("blAs1N#3479");
  await expect(panel.locator('[data-region="KR"]')).toHaveAttribute("aria-pressed", "true");
  await expect(panel.locator('[data-region="KR"]')).toHaveText("아시아");
  await expect(panel.locator('[data-region="EU"]')).toHaveAttribute("aria-pressed", "false");
  await expect(panel.locator("#account-players")).toHaveAttribute("href", "/ko/hots/players/?tag=blAs1N%233479&region=KR");
  await expect(panel.locator("#account-privacy")).toHaveAttribute("href", "/ko/hots/privacy/");
  await expect(panel.locator("#account-logout")).toBeVisible();
  await expect(panel.locator("#account-delete")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(button).toBeFocused();
  await button.click();
  await expect(panel).toBeVisible();
  await page.locator("main h1").click();
  await expect(panel).toBeHidden();
});

test("signed in on a phone: the menu fits the screen, no horizontal scroll", async ({ page }) => {
  await mockAccount(page, { battletag: "blAs1N#3479", region: "NA" });
  await page.goto("./");
  const button = page.locator("header #account-button");
  await expect(button).toContainText("blAs1N");
  await button.click();
  const box = (await page.locator("#account-panel").boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(await noHorizontalScroll(page)).toBe(true);
  await expect(page.locator("#account-players")).toHaveAttribute("href", "/ko/hots/players/?tag=blAs1N%233479&region=NA");
});

test("signed in without a region: asked once, the choice is saved", async ({ page }) => {
  const api = await mockAccount(page, { battletag: "blAs1N#3479", region: null });
  await page.goto("./");
  const panel = page.locator("#account-panel");
  await expect(panel).toBeVisible(); // opened by itself
  await expect(panel.locator("#account-region-prompt")).toBeVisible();
  await panel.locator('[data-region="EU"]').click();
  await expect(panel.locator('[data-region="EU"]')).toHaveAttribute("aria-pressed", "true");
  expect(api.calls.filter((c) => c.method === "POST" && c.path === "/v1/me/region").map((c) => c.body)).toEqual([{ region: "EU" }]);
  await expect(panel.locator("#account-region-prompt")).toHaveCount(0);
  await expect(panel.locator("#account-players")).toHaveAttribute("href", "/ko/hots/players/?tag=blAs1N%233479&region=EU");
  // asked once: closed without a choice, the next page does not open it again
  api.me = { battletag: "blAs1N#3479", region: null };
  await page.goto("./tier/");
  await expect(page.locator("header #account-button")).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.locator("#account-panel")).toBeHidden();
});

test("logout signs out and shows the login link again", async ({ page }) => {
  const api = await mockAccount(page, { battletag: "blAs1N#3479", region: "KR" });
  await page.goto("./");
  await page.locator("header #account-button").click();
  await page.locator("#account-logout").click();
  await expect(page.locator("header #account-login")).toBeVisible();
  await expect(page.locator("header #account-button")).toHaveCount(0);
  expect(api.calls.some((c) => c.method === "POST" && c.path === "/v1/auth/logout")).toBe(true);
});

test("deleting the account asks first, says what goes, and only then deletes", async ({ page }) => {
  const api = await mockAccount(page, { battletag: "blAs1N#3479", region: "KR" });
  await page.goto("./");
  await page.locator("header #account-button").click();
  await page.locator("#account-delete").click();
  const confirm = page.locator("#account-delete-confirm");
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("댓글");
  await page.locator("#account-delete-no").click();
  await expect(confirm).toHaveCount(0);
  expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);
  await page.locator("#account-delete").click();
  await page.locator("#account-delete-yes").click();
  await expect(page.locator("header #account-login")).toBeVisible();
  await expect(page.locator("#account-notice")).toContainText("삭제");
  expect(api.calls.filter((c) => c.method === "DELETE" && c.path === "/v1/me")).toHaveLength(1);
});

for (const outcome of ["failed", "cancelled"] as const) {
  test(`?login=${outcome}: a short notice, and the parameter leaves the address`, async ({ page }) => {
    await mockAccount(page, null);
    await page.goto(`./players/?tag=Zemill%231940&region=NA&login=${outcome}`);
    const notice = page.locator("#account-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute("aria-live", "polite");
    await expect(notice).toContainText(outcome === "failed" ? "로그인하지 못했습니다" : "로그인을 취소했습니다");
    await expect(page).toHaveURL(/\/ko\/hots\/players\/\?tag=Zemill%231940&region=NA$/);
  });
}

test("privacy policy in Korean and English: what is kept, the cookies, the contact; linked from the footer", async ({ page }) => {
  await mockAccount(page, null);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("./privacy/");
  await expect(page.locator("main h1")).toHaveText("개인정보처리방침");
  const main = page.locator("main");
  for (const s of ["배틀태그", "hpgg_session", "hpgg_oauth_state", "Heroes Profile", "GoatCounter", "contact@hpgg.win", "개인정보 보호책임자", "2026-10-30"]) await expect(main).toContainText(s);
  await expect(page.locator('footer a[href="/ko/hots/privacy/"]')).toBeVisible();
  await page.goto("/en/hots/privacy/");
  await expect(page.locator("main h1")).toHaveText("Privacy Policy");
  for (const s of ["BattleTag", "hpgg_session", "hpgg_oauth_state", "Heroes Profile", "GoatCounter", "contact@hpgg.win", "Privacy officer", "2026-10-30"]) await expect(page.locator("main")).toContainText(s);
  await expect(page.locator('footer a[href="/en/hots/privacy/"]')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("control: an answer that allows any origin ('*') is refused for a credentialed call — the page stays signed out", async ({ page }) => {
  await mockAccount(page, { battletag: "blAs1N#3479", region: "KR" }, "*");
  await page.goto("./");
  await expect(page.locator("header #account-login")).toBeVisible();
  await expect(page.locator("header #account-button")).toHaveCount(0);
});
