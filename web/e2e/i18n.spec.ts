import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { LOCALES } from "../src/i18n/locales";
import { messages } from "../src/i18n/messages";
import { navIds, sectionEnabled } from "../src/features";

// #10: every language under /<locale>/ from one route tree (/ko/hots/…, /en/hots/…); the header switch moves between
// them; the URLs from before (/hots/…) forward.

const playerFixture = fileURLToPath(new URL("../tests/fixtures/api_player_zemill.json", import.meta.url));
const HANGUL = /[가-힣ㄱ-ㆎ]/;

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
  await page.route("https://api.hpgg.win/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, path: playerFixture }));
});

/** Every page type: its Korean path and the English heading it must show. */
const ALL_PAGES = [
  { path: "/hots/", h1: "Today's meta", ko: "오늘의 메타" },
  { path: "/hots/tier/", h1: "Hero tier list", ko: "영웅 티어" },
  { path: "/hots/heroes/", h1: "Heroes", ko: "영웅" },
  { path: "/hots/heroes/illidan/", h1: "Illidan", ko: "일리단" },
  { path: "/hots/maps/", h1: "Battlegrounds", ko: "전장" },
  { path: "/hots/maps/cursed-hollow/", h1: "Cursed Hollow", ko: "저주받은 골짜기" },
  { path: "/hots/players/", h1: "Player search", ko: "전적 검색" },
  { path: "/hots/draft/", h1: "Draft simulator", ko: "밴픽 시뮬레이터" },
  { path: "/hots/patches/", h1: "Patch summary", ko: "패치 요약" },
  { path: "/hots/meta/", h1: "Weekly meta report", ko: "주간 메타 리포트" },
];
/** Without the sections switched off on the live site (src/features.ts): the export has no such pages. */
const PAGES = ALL_PAGES.filter((p) => sectionEnabled(p.path.split("/")[2] ?? ""));

/** Visible text on the page, minus the language switch (labelled in the other language on purpose). */
const visibleHangul = (page: Page) =>
  page.evaluate((re) => {
    const rx = new RegExp(re);
    const out: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      if (!(el instanceof HTMLElement) || el.closest("#lang-toggle, script, body [lang=ko]")) continue;
      if (!el.checkVisibility()) continue;
      for (const n of el.childNodes) if (n.nodeType === 3 && rx.test(n.textContent ?? "")) out.push(n.textContent!.trim().slice(0, 40));
      for (const a of ["placeholder", "aria-label", "title"]) {
        const v = el.getAttribute(a);
        if (v && rx.test(v)) out.push(`${a}=${v.slice(0, 40)}`);
      }
    }
    return out;
  }, HANGUL.source);

for (const p of PAGES) {
  test(`language switch on ${p.path}: ko → en → ko, same page, lang and heading follow`, async ({ page }) => {
    await page.goto(`/ko${p.path}`);
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");
    await expect(page.locator("h1")).toHaveText(p.ko);
    const toggle = page.locator("header #lang-toggle");
    await expect(toggle).toHaveText("EN");
    await expect(toggle).toHaveAttribute("href", `/en${p.path}`);
    await toggle.click();
    await expect(page).toHaveURL(new RegExp(`/en${p.path}$`));
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("h1")).toHaveText(p.h1);
    await expect(page.locator("header #lang-toggle")).toHaveText("KO");
    await page.locator("header #lang-toggle").click();
    await expect(page).toHaveURL(new RegExp(`/ko${p.path}$`));
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");
    await expect(page.locator("h1")).toHaveText(p.ko);
  });
}

test("English pages: lang=en, canonical and hreflang alternates (ko, en, x-default = ko); Korean pages point back", async ({ page }) => {
  for (const p of PAGES) {
    await page.goto(`/en${p.path}`);
    await expect(page.locator("html"), p.path).toHaveAttribute("lang", "en");
    const href = (sel: string) => page.locator(`head ${sel}`).getAttribute("href");
    expect(await href('link[rel="canonical"]'), p.path).toBe(`https://hpgg.win/en${p.path}`);
    expect(await href('link[rel="alternate"][hreflang="ko"]'), p.path).toBe(`https://hpgg.win/ko${p.path}`);
    expect(await href('link[rel="alternate"][hreflang="en"]'), p.path).toBe(`https://hpgg.win/en${p.path}`);
    expect(await href('link[rel="alternate"][hreflang="x-default"]'), p.path).toBe(`https://hpgg.win/ko${p.path}`);
    await page.goto(`/ko${p.path}`);
    expect(await href('link[rel="canonical"]'), p.path).toBe(`https://hpgg.win/ko${p.path}`);
    expect(await href('link[rel="alternate"][hreflang="en"]'), p.path).toBe(`https://hpgg.win/en${p.path}`);
  }
});

test("English pages show no Korean text, including views built in the browser", async ({ page }) => {
  const views = [
    ...PAGES.map((p) => `/en${p.path}`),
    "/en/hots/?mode=sl",
    "/en/hots/tier/?mode=sl&map=Cursed%20Hollow",
    "/en/hots/tier/?mode=sl&tier=high",
    "/en/hots/tier/?region=kr",
    ...(sectionEnabled("draft") ? ["/en/hots/draft/?map=Cursed%20Hollow&d=illidan.zeratul.tracer.genji.abathur.uther.muradin"] : []),
    "/en/hots/heroes/illidan/?mode=sl",
    "/en/hots/players/?tag=Zemill%231940&region=NA",
  ];
  // control: the same check finds Korean on a Korean page
  await page.goto("/ko/hots/");
  expect((await visibleHangul(page)).length).toBeGreaterThan(20);
  for (const v of views) {
    await page.goto(v);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main"), v).toBeVisible();
    expect(await visibleHangul(page), v).toEqual([]);
  }
  // the talent popover (English game text)
  await page.goto("/en/hots/heroes/illidan/");
  await page.locator("#builds [data-talent]").first().click();
  await expect(page.locator("#talent-pop")).toBeVisible();
  await expect(page.locator("#talent-pop [data-pop-level]")).toContainText("Level 1");
  expect(await visibleHangul(page)).toEqual([]);
});

test("English player page: modes, leagues, heroes and ARAM maps by their English names; links stay in English", async ({ page }) => {
  await page.goto("/en/hots/players/?tag=Zemill%231940&region=NA");
  await expect(page.locator("#player-result")).toHaveAttribute("data-state", "ok");
  await expect(page.locator('#player-modes [data-mode="sl"]')).toContainText("Storm League");
  await expect(page.locator('#player-modes [data-mode="sl"]')).toContainText("Diamond 2");
  await expect(page.locator('#player-modes [data-mode="ud"]')).toContainText("Unranked Draft");
  await expect(page.locator('#player-modes [data-mode="ar"]')).toContainText("ARAM");
  await expect(page.locator("#player-maps")).toContainText("Braxis Outpost");
  await expect(page.locator("#player-heroes li a").first()).toHaveAttribute("href", "/en/hots/heroes/lucio/");
  await page.locator("#player-search-tag").fill("Someone#1234");
  await page.locator("#player-search-tag").press("Enter");
  await expect(page).toHaveURL(/\/en\/hots\/players\/\?tag=Someone%231234&region=NA$/);
});

test("Korean player page: 일반 선발전 and 무작위 영웅 대전, ARAM maps in Korean", async ({ page }) => {
  await page.goto("./players/?tag=Zemill%231940&region=NA");
  await expect(page.locator('#player-modes [data-mode="ud"]')).toContainText("일반 선발전");
  await expect(page.locator('#player-modes [data-mode="ar"]')).toContainText("무작위 영웅 대전");
  await expect(page.locator("#player-maps")).toContainText("브락시스 전초기지");
});

test("English links stay in English: nav, hero search, cards and the map objective's English source", async ({ page }) => {
  await page.goto("/en/hots/");
  for (const id of navIds()) await expect(page.locator(`header a[data-page="${id}"]`).first()).toHaveAttribute("href", /^\/en\/hots\//);
  await page.locator("#site-search").fill("일리"); // Korean names stay searchable on English pages
  await expect(page.getByRole("listbox")).toContainText("Illidan");
  await page.locator("#site-search").press("Enter");
  await expect(page).toHaveURL(/\/en\/hots\/heroes\/illidan\/$/);
  await page.goto("/en/hots/maps/cursed-hollow/");
  await expect(page.locator("#objective li")).toHaveCount(3);
  await expect(page.locator("#objective")).toContainText("Raven Lord");
  await expect(page.locator("#objective-source")).toHaveAttribute("href", /web\.archive\.org\/web\/\d{14}\/https:\/\/heroesofthestorm\.com\/en-us\/battlegrounds\/cursed-hollow\//);
  await expect(page.locator("#objective-fallback")).toHaveCount(0);
});

test("the switch keeps the view: query and hash carry over", async ({ page }) => {
  await page.goto("./tier/?mode=sl&map=Cursed%20Hollow");
  await page.locator("#lang-toggle").click();
  await expect(page).toHaveURL(/\/en\/hots\/tier\/\?mode=sl&map=Cursed(%20|\+)Hollow$/);
  await expect(page.locator("#map-hero h2")).toHaveText("Cursed Hollow");
  await page.goto("/en/hots/heroes/illidan/?mode=sl#builds-title");
  await page.locator("#lang-toggle").click();
  await expect(page).toHaveURL(/\/ko\/hots\/heroes\/illidan\/\?mode=sl#builds-title$/);
  await expect(page.locator("#mode-sl")).toHaveAttribute("aria-pressed", "true");
});

test("the choice is a redirect hint: a Korean link opens in English once English was chosen, and back", async ({ page }) => {
  await page.goto("./");
  await page.locator("#lang-toggle").click();
  await expect(page).toHaveURL(/\/en\/hots\/$/);
  // record which language the document had when its HTML was parsed: never Korean after choosing English
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      (window as unknown as { __langAtDCL: string }).__langAtDCL = document.documentElement.lang;
    });
  });
  await page.goto("./maps/?x=1#top");
  await expect(page).toHaveURL(/\/en\/hots\/maps\/\?x=1#top$/);
  expect(await page.evaluate(() => (window as unknown as { __langAtDCL: string }).__langAtDCL)).toBe("en");
  await page.locator("#lang-toggle").click();
  await expect(page).toHaveURL(/\/ko\/hots\/maps\/\?x=1#top$/);
  await page.goto("./tier/");
  await expect(page).toHaveURL(/\/ko\/hots\/tier\/$/); // Korean chosen: stays Korean
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
});

test("a switch clicked before hydration is not bounced back: arriving from the other language in-site wins and becomes the choice", async ({ page }) => {
  await page.goto("/en/hots/heroes/");
  await page.evaluate((k) => localStorage.setItem(k, "en"), "hpgg-locale"); // English chosen earlier
  // the plain link without its click handler: same navigation, old choice still stored
  await page.goto("/ko/hots/heroes/", { referer: new URL("/en/hots/heroes/", page.url()).href });
  await expect(page).toHaveURL(/\/ko\/hots\/heroes\/$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  expect(await page.evaluate((k) => localStorage.getItem(k), "hpgg-locale")).toBe("ko");
  // control: the same URL entered from outside still follows the stored choice
  await page.evaluate((k) => localStorage.setItem(k, "en"), "hpgg-locale");
  await page.goto("/ko/hots/heroes/", { referer: "https://www.google.com/" });
  await expect(page).toHaveURL(/\/en\/hots\/heroes\/$/);
});

test("without a choice nothing redirects, whatever the browser language", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  const page = await ctx.newPage();
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
  await page.goto(new URL("./tier/", test.info().project.use.baseURL).href);
  await expect(page).toHaveURL(/\/ko\/hots\/tier\/$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await ctx.close();
});

test("blocked storage: the switch still changes the language, no page error", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("SecurityError");
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./heroes/");
  await page.locator("#lang-toggle").click();
  await expect(page).toHaveURL(/\/en\/hots\/heroes\/$/);
  await expect(page.locator("h1")).toHaveText("Heroes");
  expect(errors).toEqual([]);
});

test("/en/ and /ko/ forward to their section; the 404 page speaks both languages", async ({ page }) => {
  await page.goto("/ko/");
  await expect(page).toHaveURL(/\/ko\/hots\/$/);
  await page.goto("/en/");
  await expect(page).toHaveURL(/\/en\/hots\/$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const res = await page.goto("/en/hots/heroes/nobody/");
  expect(res?.status()).toBe(404);
  await expect(page.locator("main")).toContainText("그런 페이지나 영웅이 없습니다");
  await expect(page.locator("main")).toContainText("No such page or hero");
  await expect(page.locator('main a[href="/en/hots/"]')).toHaveCount(1);
  await expect(page.locator('main a[href="/ko/hots/"]')).toHaveCount(1);
});

test("the switch sits next to the theme toggle, on phones and desktop", async ({ page }) => {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("./");
    const lang = await page.locator("header #lang-toggle").boundingBox();
    const theme = await page.locator("header #theme-toggle").boundingBox();
    expect(lang && theme, `${width}`).toBeTruthy();
    expect(Math.abs(lang!.y - theme!.y), `${width}`).toBeLessThan(2);
    expect(theme!.x - (lang!.x + lang!.width), `${width}`).toBeLessThan(12);
    expect(theme!.x - (lang!.x + lang!.width), `${width}`).toBeGreaterThanOrEqual(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${width}`).toBeLessThanOrEqual(0);
  }
});

test("every page renders for every language in LOCALES, from the one route tree", async ({ page }) => {
  for (const locale of LOCALES) {
    for (const p of PAGES) {
      const res = await page.goto(`/${locale}${p.path}`);
      expect(res?.status(), `${locale}${p.path}`).toBe(200);
      await expect(page.locator("html"), `${locale}${p.path}`).toHaveAttribute("lang", locale);
      await expect(page.locator("header nav a[data-page=home]").first(), `${locale}${p.path}`).toHaveText(messages[locale].nav.home);
    }
  }
  // a language outside LOCALES has no pages
  expect((await page.goto("/fr/hots/"))?.status()).toBe(404);
});

// The URLs that were live before #10 (Korean at /hots/…): shared links keep working.
const e2eData = (f: string) => JSON.parse(readFileSync(new URL(`../tests/e2e-data/${f}`, import.meta.url), "utf-8"));

test("every old hero and map URL has a forwarder pointing at its new page", async ({ request }) => {
  const heroes: { slug: string }[] = e2eData("heroes_ko.json").heroes;
  const maps: { slug: string }[] = e2eData("maps_ko.json").maps;
  const old = [
    "/hots/", "/hots/tier/", "/hots/heroes/", "/hots/maps/", "/hots/players/",
    ...heroes.map((h) => `/hots/heroes/${h.slug}/`),
    ...maps.map((m) => `/hots/maps/${m.slug}/`),
  ];
  expect(old.length).toBe(5 + 90 + 15);
  for (const path of old) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(200);
    const html = await res.text();
    expect(html, path).toContain(`<link rel="canonical" href="https://hpgg.win/ko${path}">`);
    expect(html, path).toContain(`content="0; url=/ko${path}"`);
    expect(html, path).toContain('<meta name="robots" content="noindex">');
    // and the page it points at exists
    expect((await request.get(`/ko${path}`)).status(), `/ko${path}`).toBe(200);
  }
});

test("forwarders land on the new URL with query and hash; legacy .html go straight there; / follows the stored choice", async ({ page }) => {
  await page.goto("/hots/heroes/illidan/?mode=sl#builds-title");
  await expect(page).toHaveURL(/\/ko\/hots\/heroes\/illidan\/\?mode=sl#builds-title$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await page.goto("/hots/tier/?mode=sl&map=Cursed%20Hollow");
  await expect(page).toHaveURL(/\/ko\/hots\/tier\/\?mode=sl&map=Cursed%20Hollow$/);
  await page.goto("/hots/hero.html?hero=illidan&mode=sl");
  await expect(page).toHaveURL(/\/ko\/hots\/heroes\/illidan\/\?mode=sl$/);
  await page.goto("/hots/tier.html?mode=sl&role=Healer");
  await expect(page).toHaveURL(/\/ko\/hots\/tier\/\?mode=sl&role=Healer$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/ko\/hots\/$/);
  await page.locator("#lang-toggle").click(); // choose English
  await expect(page).toHaveURL(/\/en\/hots\/$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/en\/hots\/$/);
  await page.goto("/hots/maps/cursed-hollow/");
  await expect(page).toHaveURL(/\/en\/hots\/maps\/cursed-hollow\/$/); // one hop, not /ko then /en
});

test("without JavaScript the forwarders still move on (meta refresh)", async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(new URL("/hots/maps/", test.info().project.use.baseURL).href);
  await expect(page).toHaveURL(/\/ko\/hots\/maps\/$/);
  await ctx.close();
});
