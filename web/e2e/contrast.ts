import type { Page } from "@playwright/test";

/** Every visible text element against the colours stacked behind it: WCAG AA (4.5:1, large text 3:1). Shared by the
 *  theme spec (every page) and the specs of views a plain page load does not reach (the member's 내 영웅풀). */
export async function lowContrast(page: Page): Promise<{ fails: string[]; measured: number }> {
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
