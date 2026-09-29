import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { contrast, parseTokens } from "../src/lib/contrast";
import { DEFAULT_THEME, readTheme, THEME_COLOR, THEME_INIT_SCRIPT, THEME_KEY, writeTheme } from "../src/lib/theme";

const store = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
const throwing = () => {
  throw new Error("SecurityError: storage is disabled");
};

describe("theme preference", () => {
  it("navy (dark) is the default when nothing is stored or the value is unknown", () => {
    expect(DEFAULT_THEME).toBe("dark");
    expect(readTheme(() => store())).toBe("dark");
    expect(readTheme(() => store({ [THEME_KEY]: "sepia" }))).toBe("dark");
    expect(readTheme(() => store({ [THEME_KEY]: "light" }))).toBe("light");
  });

  it("storage that throws (private window, blocked site data) falls back to the default instead of breaking the page", () => {
    expect(readTheme(throwing)).toBe("dark");
    expect(readTheme(() => ({ getItem: throwing }))).toBe("dark");
    expect(writeTheme("light", throwing)).toBe(false);
    expect(writeTheme("light", () => ({ setItem: throwing }))).toBe(false);
  });

  it("writeTheme stores the choice under the shared key", () => {
    const s = store();
    expect(writeTheme("light", () => s)).toBe(true);
    expect(s.m.get(THEME_KEY)).toBe("light");
    expect(readTheme(() => s)).toBe("light");
  });

  it("the inline init script marks <html> light only for a stored light choice, and survives throwing storage", () => {
    const run = (ls: unknown) => {
      const el = { dataset: {} as Record<string, string> };
      const meta = { setAttribute: (_: string, v: string) => (el.dataset.meta = v) };
      const doc = { documentElement: el, querySelector: () => meta };
      new Function("document", "localStorage", THEME_INIT_SCRIPT)(doc, ls);
      return el.dataset;
    };
    expect(run(store({ [THEME_KEY]: "light" }))).toEqual({ theme: "light", meta: THEME_COLOR.light });
    expect(run(store())).toEqual({});
    expect(run(store({ [THEME_KEY]: "dark" }))).toEqual({});
    expect(run({ getItem: throwing })).toEqual({});
  });
});

// WCAG AA: 4.5:1 for body text. Every text token on every surface it is drawn on, in both themes.
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "styles", "globals.css"), "utf-8");

describe("colour tokens", () => {
  const dark = parseTokens(css, "dark");
  const light = parseTokens(css, "light");

  it("every dark token has a light value", () => {
    const themed = Object.keys(dark).filter((k) => !k.startsWith("tier-") && !k.startsWith("role-"));
    expect(themed.length).toBeGreaterThan(15); // control: the parser finds the @theme block
    expect(themed.filter((k) => !(k in light))).toEqual([]);
  });

  it("contrast() matches known WCAG values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  const TEXT = ["fg", "fg-2", "muted", "primary", "secondary", "accent", "pos", "neg"];
  const SURFACES = ["canvas", "bg", "surface", "surface-2"];
  for (const [name, t] of [
    ["dark", dark],
    ["light", light],
  ] as const) {
    it(`${name}: text tokens reach AA (4.5:1) on every surface`, () => {
      const fails: string[] = [];
      for (const fg of TEXT)
        for (const bg of SURFACES) {
          const r = contrast(t[fg]!, t[bg]!);
          if (r < 4.5) fails.push(`${fg} on ${bg}: ${r.toFixed(2)}`);
        }
      // the selected role pill and the ▲▼ "— 0" chip draw fg / muted on surface-3
      for (const fg of ["fg", "fg-2", "muted"]) {
        const r = contrast(t[fg]!, t["surface-3"]!);
        if (r < 4.5) fails.push(`${fg} on surface-3: ${r.toFixed(2)}`);
      }
      for (const [fg, bg] of [
        ["primary-ink", "primary"],
        ["warn-fg", "warn-bg"],
        ["warn-ink", "warn-strong"],
        ["pop-fg", "pop"],
        ["fg", "pop"],
        ["accent", "pop"],
      ]) {
        const r = contrast(t[fg!]!, t[bg!]!);
        if (r < 4.5) fails.push(`${fg} on ${bg}: ${r.toFixed(2)}`);
      }
      expect(fails).toEqual([]);
    });
  }

  it("tier badges (dark text on the tier colour) read the same in both themes", () => {
    for (const tier of ["s", "a", "b", "c", "d", "f"]) {
      expect(light[`tier-${tier}`] ?? dark[`tier-${tier}`]).toBe(dark[`tier-${tier}`]);
      expect(contrast(dark["tier-ink"]!, dark[`tier-${tier}`]!)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("components use colour tokens", () => {
  // a raw colour does not change with the theme: white text on a light surface, a navy panel in light mode
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx$/.test(e.name) ? [join(dir, e.name)] : []));
  it("no raw hex, white or black colour utilities in app/ or src/components/", () => {
    const files = [...walk(join(root, "app")), ...walk(join(root, "src", "components"))];
    expect(files.length).toBeGreaterThan(10); // control: the walk finds the components
    const raw = /\b(?:text|bg|border|ring|from|via|to|fill|stroke|outline|decoration)-(?:white|black|\[#[0-9a-fA-F]{3,8}\])/;
    expect(raw.test('className="text-[#ffd8a8]"')).toBe(true); // control: the pattern catches what it guards
    expect(files.filter((f) => raw.test(readFileSync(f, "utf-8"))).map((f) => f.slice(root.length))).toEqual([]);
  });
});

// Hero portraits are game art with transparent corners. A themed surface behind them turns light
// grey in the light theme and the art looks cut out, so they sit on one dark backdrop in both themes.
describe("portrait backdrop", () => {
  const dark = parseTokens(css, "dark");
  const light = parseTokens(css, "light");

  it("is the same dark colour in both themes", () => {
    expect(dark["portrait"]).toBeDefined();
    expect(light["portrait"] ?? dark["portrait"]).toBe(dark["portrait"]);
    expect(contrast(dark["portrait"]!, "#000000")).toBeLessThan(2); // close to black, not a light grey
  });

  it("Portrait draws on it, not on a themed surface", () => {
    const ui = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "components", "ui.tsx"), "utf-8");
    const portrait = ui.slice(ui.indexOf("export function Portrait"), ui.indexOf("export const wrTone"));
    expect(portrait).toContain("bg-portrait");
    expect(portrait).not.toMatch(/bg-surface/);
  });
});
