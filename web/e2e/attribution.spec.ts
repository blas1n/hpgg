import { expect, test } from "@playwright/test";

// Heroes Profile API terms §4 (https://www.heroesprofile.com/Api/Terms, pointed out by HP 2026-09-29): on every page that
// shows its data, "Data provided by Heroes Profile" with a visible link, on the same screen as the data (no scrolling
// past other content), no smaller than the body text, not styled as fine print. The footer credit alone was 4,500 px down.
test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
  await page.route("https://www.heroesprofile.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>stub</p>" }));
});

const PAGES = ["./", "./tier/", "./heroes/", "./heroes/illidan/", "./maps/", "./maps/cursed-hollow/", "./draft/", "./players/", "../../en/hots/tier/"];

for (const path of PAGES) {
  for (const width of [390, 1280]) {
    test(`attribution on ${path} at ${width}px: first screen, body-sized, linked`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
      await page.goto(path);
      const credit = page.locator("#hp-attribution");
      await expect(credit).toHaveText("Data provided by Heroes Profile");
      await expect(credit.locator('a[href="https://www.heroesprofile.com/"]')).toBeVisible();
      const box = (await credit.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height); // on the first screen, no scrolling
      const px = await credit.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(px).toBeGreaterThanOrEqual(14); // the pages' body text is text-sm (14px)
      const color = await credit.evaluate((el) => getComputedStyle(el).color);
      const muted = await page.evaluate(() => {
        const p = document.createElement("p");
        p.className = "text-muted";
        document.body.appendChild(p);
        const c = getComputedStyle(p).color;
        p.remove();
        return c;
      });
      expect(color).not.toBe(muted); // not the grey fine-print colour
    });
  }
}
