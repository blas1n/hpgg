/** WCAG 2 contrast between two #rrggbb colours (1–21). */
export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

function luminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/**
 * Colour tokens from globals.css: `dark` = the `@theme` block (the default), `light` = the
 * `:root[data-theme="light"]` block. Names without the `--color-` prefix.
 */
export function parseTokens(css: string, theme: "dark" | "light"): Record<string, string> {
  const block = theme === "dark" ? /@theme\s*\{([\s\S]*?)\n\}/.exec(css) : /:root\[data-theme="light"\]\s*\{([\s\S]*?)\}/.exec(css);
  const out: Record<string, string> = {};
  for (const m of (block?.[1] ?? "").matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]!] = m[2]!.toLowerCase();
  return out;
}
