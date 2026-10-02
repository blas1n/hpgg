import { expect, test } from "@playwright/test";
import { LOCALES } from "../src/i18n/locales";

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
