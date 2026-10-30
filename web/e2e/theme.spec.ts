import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { sectionEnabled } from "../src/features";
import { lowContrast } from "./contrast";
/** Pages of switched-off sections (src/features.ts) are not in the export. */
const live = (path: string): boolean => sectionEnabled(path.split("/")[1]?.split("?")[0] ?? "");

const playerFixture = fileURLToPath(new URL("../tests/fixtures/api_player_zemill.json", import.meta.url));

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
  // 전적 검색 results come from the API; serve the recorded profile so its text is measured too
  await page.route("https://api.hpgg.win/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, path: playerFixture }));
});

// Light theme (#1): navy stays the default; the header toggle switches and remembers; no flash of the wrong theme.

const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test("theme: navy by default, even when the system prefers light", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("./");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "light");
  expect(await bodyBg(page)).toBe("rgb(14, 17, 24)");
  await expect(page.locator("#theme-toggle")).toBeVisible();
  await expect(page.locator("#theme-toggle")).toHaveAttribute("aria-pressed", "false");
});

test("theme: the toggle switches to light, persists across pages and reloads, and switches back", async ({ page }) => {
  await page.goto("./");
  await page.locator("#theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("#theme-toggle")).toHaveAttribute("aria-pressed", "true");
  expect(await bodyBg(page)).not.toBe("rgb(14, 17, 24)");
  // no flash: the theme is on <html> before the first paint (DOMContentLoaded, before React hydrates)
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      (window as unknown as { __themeAtDCL: string }).__themeAtDCL = document.documentElement.dataset.theme ?? "dark";
    });
  });
  await page.goto("./tier/");
  expect(await page.evaluate(() => (window as unknown as { __themeAtDCL: string }).__themeAtDCL)).toBe("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.locator("#theme-toggle").click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "light");
});

test("theme: blocked storage still renders navy and the toggle still works for the visit", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("SecurityError");
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  expect(await bodyBg(page)).toBe("rgb(14, 17, 24)");
  await page.locator("#theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(errors).toEqual([]);
});

test("theme: the toggle is in the header on desktop too", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("./");
  await expect(page.locator("header #theme-toggle")).toBeVisible();
});

// WCAG AA on every page in both themes: every visible text run against the colour actually behind it.
test("contrast checker control: a planted low-contrast line is caught, and text is actually measured", async ({ page }) => {
  await page.goto("./");
  await page.evaluate(() => {
    const p = document.createElement("p");
    p.id = "planted";
    p.textContent = "planted grey on navy";
    p.style.color = "#333a4a";
    document.querySelector("main")!.append(p);
  });
  const { fails, measured } = await lowContrast(page);
  expect(measured).toBeGreaterThan(50);
  expect(fails.join("\n")).toContain("planted grey on navy");
});

for (const theme of ["dark", "light"] as const) {
  for (const width of [390, 1280]) {
    test(`contrast: ${theme} theme at ${width}px — all text on every page reaches WCAG AA, Korean and English`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 900 });
      if (theme === "light") await page.addInitScript(() => localStorage.setItem("hpgg-theme", "light"));
      const ko = ["./", "./tier/", "./tier/?mode=sl", "./heroes/", "./heroes/illidan/", "./heroes/illidan/?mode=sl", "./maps/", "./maps/cursed-hollow/", "./maps/towers-of-doom/", "./patches/", "./meta/", "./meta/?mode=sl", "./players/", "./players/?tag=Zemill%231940&region=NA", "./draft/", "./draft/?map=Cursed%20Hollow&d=illidan.zeratul.tracer.genji.abathur.uther.muradin", "./privacy/"].filter(live);
      // English pages (#10): the same pages under /en/hots/ — longer words, other line breaks
      for (const path of [...ko, ...ko.map((p) => `/en/hots/${p.slice(2)}`)]) {
        await page.goto(path);
        await expect(page.locator("main")).toBeVisible();
        if (theme === "light") await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
        await page.waitForLoadState("networkidle");
        const { fails, measured } = await lowContrast(page);
        expect(measured, `${path}: text was measured`).toBeGreaterThan(20);
        expect(fails, `${theme} ${width} ${path}`).toEqual([]);
      }
    });
  }
}
