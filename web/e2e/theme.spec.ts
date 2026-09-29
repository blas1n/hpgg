import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/gc.zgo.at/**", (r) => r.abort());
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
async function lowContrast(page: Page): Promise<{ fails: string[]; measured: number }> {
  return page.evaluate(() => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    const rgba = (c: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
    };
    const over = (top: [number, number, number, number], under: [number, number, number]): [number, number, number] =>
      [0, 1, 2].map((i) => top[i]! * top[3] + under[i]! * (1 - top[3])) as [number, number, number];
    const lum = ([r, g, b]: [number, number, number]) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    // background behind an element: stack the ancestors' colours; null when an image or gradient is involved
    const behind = (el: Element): [number, number, number] | null => {
      const layers: [number, number, number, number][] = [];
      for (let e: Element | null = el; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.backgroundImage !== "none" || e.tagName === "IMG") return null;
        const c = rgba(s.backgroundColor);
        if (c[3] > 0) layers.push(c);
        if (c[3] >= 1) break;
      }
      let base: [number, number, number] = [255, 255, 255];
      for (const l of layers.reverse()) base = over(l, base);
      return base;
    };
    const out: string[] = [];
    let measured = 0;
    for (const el of document.querySelectorAll("body *")) {
      const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent!.trim()).join("");
      if (!text || !(el instanceof HTMLElement) || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      if (el.closest("[aria-busy=true], option, .sr-only, [data-contrast-exempt]")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      // text sitting on a map image (map cards, the map banner) is drawn over a gradient scrim: not measurable here
      const stack = document.elementsFromPoint(r.left + Math.min(r.width, 4), r.top + r.height / 2);
      if (stack.some((s) => s.tagName === "IMG" && !el.contains(s) && !s.contains(el))) continue;
      const bg = behind(el);
      if (!bg) continue;
      measured++;
      const s = getComputedStyle(el);
      const fg = over(rgba(s.color), bg);
      const L1 = lum(fg);
      const L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const size = parseFloat(s.fontSize);
      const large = size >= 24 || (size >= 18.66 && parseInt(s.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) out.push(`${ratio.toFixed(2)} "${text.slice(0, 30)}" <${el.tagName.toLowerCase()} class="${el.className}">`);
    }
    return { fails: out, measured };
  });
}

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
    test(`contrast: ${theme} theme at ${width}px — all text on every page reaches WCAG AA`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      if (theme === "light") await page.addInitScript(() => localStorage.setItem("hpgg-theme", "light"));
      for (const path of ["./", "./tier/", "./tier/?mode=sl", "./heroes/", "./heroes/illidan/", "./heroes/illidan/?mode=sl", "./maps/"]) {
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
