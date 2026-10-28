import { expect, test } from "@playwright/test";
import { NAVER_SITE_VERIFICATION } from "../src/i18n/locales";

// Owner 2026-10-28: each language's titles use its own search words; Naver verifies the site root with a meta tag.

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
});

const naver = `meta[name="naver-site-verification"][content="${NAVER_SITE_VERIFICATION}"]`;

test("hero page titles: 히오스 in Korean, Heroes of the Storm in English", async ({ page }) => {
  await page.goto("/ko/hots/heroes/abathur/");
  await expect(page).toHaveTitle("아바투르 빌드·티어·상성 - 히오스 | HPGG");
  await page.goto("/en/hots/heroes/abathur/");
  await expect(page).toHaveTitle("Abathur Build, Tier & Counters - Heroes of the Storm | HPGG");
});

test("section and home titles carry the game's name once", async ({ page }) => {
  await page.goto("/ko/hots/tier/");
  await expect(page).toHaveTitle("히오스 티어표 (빠른 대전 · 폭풍 리그 전장별) | HPGG");
  await page.goto("/ko/hots/");
  await expect(page).toHaveTitle("히오스 티어표 · 영웅 통계 · 전적 검색 | HPGG");
});

test("the Naver tag is on the pages and on the site root Naver checks", async ({ page, request }) => {
  await page.goto("/ko/hots/");
  await expect(page.locator(naver)).toHaveCount(1);
  const root = await request.get("/", { maxRedirects: 0 });
  expect(await root.text()).toContain(`<meta name="naver-site-verification" content="${NAVER_SITE_VERIFICATION}">`);
});
