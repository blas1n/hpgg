import { expect, test } from "@playwright/test";

// Player search starts in the visitor's region (owner 2026-10-04: English and EU visitors started on Asia and found
// nobody): a region chosen before, else the browser's time zone, else the page language. A search that finds nobody
// offers the other regions in one click.

const json = (status: number, body: unknown) => ({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
});

test.describe("a visitor in Europe", () => {
  test.use({ timezoneId: "Europe/Berlin" });

  test("starts on EU, on the English and the Korean page, and on 홈's search box", async ({ page }) => {
    await page.goto("/en/hots/players/");
    await expect(page.locator("#player-search-region")).toHaveValue("EU");
    await page.goto("/ko/hots/");
    await expect(page.locator("#home-player-search-region")).toHaveValue("EU");
  });

  test("a region chosen before wins over the time zone", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("hpgg-region", "NA"));
    await page.goto("/en/hots/players/");
    await expect(page.locator("#player-search-region")).toHaveValue("NA");
  });

  test("searching remembers the region", async ({ page }) => {
    await page.route("https://api.hpgg.win/**", (r) => r.fulfill(json(404, { error: { code: "player_not_found" } })));
    await page.goto("/en/hots/players/");
    await page.locator("#player-search-region").selectOption("KR");
    await page.locator("#player-search-tag").fill("Nobody#1234");
    await page.locator("#player-search-tag").press("Enter");
    await expect(page.locator("#player-result")).toHaveAttribute("data-state", "not_found");
    expect(await page.evaluate(() => localStorage.getItem("hpgg-region"))).toBe("KR");
  });
});

test.describe("a visitor in the Americas", () => {
  test.use({ timezoneId: "America/New_York" });

  test("starts on NA", async ({ page }) => {
    await page.goto("/en/hots/players/");
    await expect(page.locator("#player-search-region")).toHaveValue("NA");
  });
});

test("nobody found: the other regions are one click away", async ({ page }) => {
  const asked: string[] = [];
  await page.route("https://api.hpgg.win/**", (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === "/v1/players") asked.push(u.searchParams.get("region") ?? "");
    return r.fulfill(json(404, { error: { code: "player_not_found" } }));
  });
  await page.goto("/en/hots/players/?tag=Nobody%231234&region=NA");
  const result = page.locator("#player-result");
  await expect(result).toHaveAttribute("data-state", "not_found");
  const others = result.locator("[data-other-region]");
  await expect(others).toHaveCount(2);
  await expect(result.locator('[data-other-region="NA"]')).toHaveCount(0); // not the one just searched
  await result.locator('[data-other-region="EU"]').click();
  await expect(page).toHaveURL(/region=EU/);
  await expect.poll(() => asked).toEqual(["NA", "EU"]);
});
