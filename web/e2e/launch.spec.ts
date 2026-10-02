import { expect, test } from "@playwright/test";
import { LOCALES } from "../src/i18n/locales";
import { FEATURES } from "../src/features";

// Before the first community post (2026-10-02): a crawler finds robots.txt and the sitemap, and a link pasted into
// Inven, Arca, Discord or KakaoTalk previews as a 1200×630 card in the page's language.

test("robots.txt allows crawling and names the sitemap", async ({ request }) => {
  const res = await request.get("/robots.txt");
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain("Sitemap: https://hpgg.win/sitemap.xml");
});

test("sitemap.xml lists the pages of every language", async ({ request }) => {
  const res = await request.get("/sitemap.xml");
  expect(res.status()).toBe(200);
  const xml = await res.text();
  for (const l of LOCALES) {
    expect(xml).toContain(`<loc>https://hpgg.win/${l}/hots/tier/</loc>`);
    expect(xml).toContain(`<loc>https://hpgg.win/${l}/hots/heroes/illidan/</loc>`);
  }
});

for (const locale of LOCALES) {
  // the image itself (1200×630) is checked against data/ in tests/og.test.ts; the e2e data has no brand images
  test(`${locale}: the link preview is the card in that language`, async ({ page }) => {
    await page.route("**/gc.zgo.at/**", (r) => r.abort());
    await page.goto(`/${locale}/hots/tier/`);
    const og = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(og).toBe(`https://hpgg.win/img/brand/og-${locale}.png`);
    if (locale === "ko") {
      const desc = await page.locator('meta[property="og:description"]').getAttribute("content");
      expect(desc).toContain("계산식 공개");
    }
  });
}

// owner 2026-10-02: 밴픽 is switched off until its suggestions account for team roles (src/features.ts)
test("a switched-off section is not in the menu, the sitemap or the site", async ({ page, request }) => {
  test.skip(FEATURES.draft, "밴픽 is on");
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
  for (const l of LOCALES) {
    await page.goto(`/${l}/hots/`);
    await expect(page.locator('header a[data-page="tier"]').first()).toBeAttached(); // the menu is there
    await expect(page.locator('header a[data-page="draft"]')).toHaveCount(0);
    expect((await request.get(`/${l}/hots/draft/`)).status()).toBe(404);
  }
  expect(await (await request.get("/sitemap.xml")).text()).not.toContain("/hots/draft/");
});
