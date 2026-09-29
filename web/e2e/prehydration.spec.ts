import { expect, test, type Browser, type Page } from "@playwright/test";

// The static HTML must already carry the final layout at every width: the desktop-only columns are in the markup and
// shown or hidden by CSS breakpoints, so hydration never adds a column or moves a row (#30 deferred list). Checked
// with JavaScript off (what the first paint shows) against the hydrated page.

const DESKTOP = ["rank", "tier", "hero", "role", "score", "win_rate", "pick", "games"];
const TABLET = ["rank", "tier", "hero", "score", "win_rate", "pick", "games"];
const PHONE = ["rank", "hero", "score", "win_rate", "pick"];

async function open(browser: Browser, js: boolean, width: number, path: string): Promise<Page> {
  const ctx = await browser.newContext({ javaScriptEnabled: js, viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready); // the web font changes text widths; compare like with like
  return page;
}

/** Visible header columns, and the box of every visible cell in the first rows and of the table itself. */
async function layout(page: Page) {
  return page.evaluate(() => {
    const seen = (e: Element) => e.getBoundingClientRect().width > 0;
    const box = (e: Element) => {
      const r = e.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(",");
    };
    const cols = [...document.querySelectorAll("#table thead th")].filter(seen).map((e) => e.getAttribute("data-col"));
    const rows = [...document.querySelectorAll("#rows tr")].slice(0, 8);
    const cells = rows.flatMap((r) => [...r.querySelectorAll("td")].filter(seen).map((td) => `${td.getAttribute("data-col") ?? "span"}@${box(td)}`));
    return { cols, cells, table: box(document.querySelector("#table")!) };
  });
}

for (const [width, cols] of [[1280, DESKTOP], [800, TABLET], [390, PHONE]] as const) {
  test(`tier table at ${width} px: the pre-rendered HTML has the final columns and layout`, async ({ browser, baseURL }) => {
    const url = `${baseURL}tier/`;
    const first = await open(browser, false, width, url);
    const before = await layout(first);
    expect(before.cols).toEqual(cols);
    const row = first.locator('#rows tr[data-hero="illidan"]');
    const portraitBadge = first.locator('#rows tr[data-hero] td[data-col="hero"] .tier-badge').first();
    const interval = row.locator('td[data-col="win_rate"] span:not([data-v])');
    if (width >= 640) {
      await expect(first.locator('#rows tr[data-hero] td[data-col="tier"] .tier-badge').first()).toBeVisible();
      await expect(portraitBadge).toBeHidden();
    } else await expect(portraitBadge).toBeVisible(); // on a phone the tier stays on the portrait
    if (width >= 1024) {
      await expect(row.locator('td[data-col="role"]')).toHaveText("근접 암살자");
      await expect(interval).toHaveText("±1.2");
    } else await expect(interval).toBeHidden(); // the ± interval is desktop-only
    const hydrated = await open(browser, true, width, url);
    expect(await layout(hydrated)).toEqual(before);
  });
}

for (const width of [1280, 800, 390]) {
  test(`tier table at ${width} px: divider and opened rows span the whole table`, async ({ browser, baseURL }) => {
    const page = await open(browser, true, width, `${baseURL}tier/`);
    const table = (await page.locator("#table").boundingBox())!;
    const divider = (await page.locator('#rows tr[data-tier-group="S"] td').boundingBox())!;
    expect(Math.abs(divider.width - table.width)).toBeLessThanOrEqual(2);
    await page.locator('#rows tr[data-hero="illidan"]').click();
    const detail = (await page.locator('#rows tr[data-detail="illidan"] td').boundingBox())!;
    expect(Math.abs(detail.width - table.width)).toBeLessThanOrEqual(2);
    // a spanning row adds no phantom column: the visible header cells fill the table and the hero name is readable
    const filled = await page.locator("#table thead th").evaluateAll((els) => els.reduce((w, e) => w + e.getBoundingClientRect().width, 0));
    expect(Math.abs(filled - table.width)).toBeLessThanOrEqual(2);
    expect((await page.locator('th[data-col="hero"]').boundingBox())!.width).toBeGreaterThanOrEqual(width >= 1024 ? 240 : 120);
    await expect(page.locator('#rows tr[data-hero="illidan"] [data-name]')).toBeVisible();
  });
}

test("hero page at 1280 px: the pre-rendered layout is the hydrated one", async ({ browser, baseURL }) => {
  const sig = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll("main section, main h1, #stats")].map((e) => {
        const r = e.getBoundingClientRect();
        return `${e.id || e.tagName}:${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`;
      }),
    );
  const url = `${baseURL}heroes/illidan/`;
  const before = await sig(await open(browser, false, 1280, url));
  expect(before.length).toBeGreaterThan(3);
  expect(await sig(await open(browser, true, 1280, url))).toEqual(before);
});
