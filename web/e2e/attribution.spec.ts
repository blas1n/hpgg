import { expect, test } from "@playwright/test";
import { sectionEnabled } from "../src/features";

// Heroes Profile API terms §4 (https://www.heroesprofile.com/Api/Terms, pointed out by HP 2026-09-29): on every page that
// shows its data, "Data provided by Heroes Profile" with a visible link, on the same screen as the data (no scrolling
// past other content), no smaller than the body text, not styled as fine print. The footer credit alone was 4,500 px down.
test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
  await page.route("https://www.heroesprofile.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>stub</p>" }));
});

/** Pages of switched-off sections (src/features.ts) are not in the export. */
const live = (path: string): boolean => sectionEnabled(path.split("/")[1]?.split("?")[0] ?? "");
const PAGES = ["./", "./tier/", "./heroes/", "./heroes/illidan/", "./maps/", "./maps/cursed-hollow/", "./draft/", "./players/", "../../en/hots/tier/"].filter(live);

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

// Owner 2026-10-01: the credit used to sit alone ABOVE the page title, which read as a line slapped under the header.
// It now belongs to the title: on the title's line where that row has room, otherwise on the line directly under it
// (a long title, or the home page's mode toggle holding the right of the row at phone width). Never above the title,
// and never separated from it by other content.
const TITLED = [
  { path: "./", title: "오늘의 메타" },
  { path: "./tier/", title: "영웅 티어" },
  { path: "./heroes/", title: "영웅" },
  { path: "./maps/", title: "전장" },
  { path: "./draft/", title: "밴픽 시뮬레이터" },
  { path: "./players/", title: "전적 검색" },
].filter((p) => live(p.path));

for (const { path, title } of TITLED) {
  test(`credit belongs to the title on ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(path);
    await expect(page.locator("h1")).toHaveText(title);
    let h1 = (await page.locator("h1").boundingBox())!;
    let credit = (await page.locator("#hp-attribution").boundingBox())!;
    // desktop: the row has room, so the credit sits on the title's line, to its right
    expect(credit.y).toBeLessThan(h1.y + h1.height);
    expect(credit.x).toBeGreaterThan(h1.x + h1.width);

    await page.setViewportSize({ width: 390, height: 844 });
    h1 = (await page.locator("h1").boundingBox())!;
    credit = (await page.locator("#hp-attribution").boundingBox())!;
    // phone: the title's line or the one directly under it — never above the title
    expect(credit.y).toBeGreaterThanOrEqual(h1.y);
    expect(credit.y).toBeLessThan(h1.y + h1.height + 28);
  });
}

test("home: nothing of the page's own content comes between the heading and its credit", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  const credit = (await page.locator("#hp-attribution").boundingBox())!;
  const meta = (await page.locator("#meta-line").boundingBox())!;
  expect(credit.y).toBeLessThan(meta.y);
  expect(credit.x).toBeLessThan((await page.locator("h1").boundingBox())!.x + 2); // left-aligned with its heading
});

test("the credit never breaks mid-phrase", async ({ page }) => {
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("./tier/");
    expect(await page.locator("#hp-attribution").evaluate((el) => el.getClientRects().length)).toBe(1);
  }
});

test("the title is the first thing on the page, and the credit costs it no vertical room", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("./tier/");
  const header = (await page.locator("header").boundingBox())!;
  const h1 = (await page.locator("h1").boundingBox())!;
  expect(h1.y - (header.y + header.height)).toBeLessThanOrEqual(28); // the title opens the page; nothing sits in the gap
  expect((await page.locator("#hp-attribution").boundingBox())!.y).toBeGreaterThanOrEqual(h1.y - 2);
});
