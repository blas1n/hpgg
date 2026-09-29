import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { LOCALES } from "../src/i18n/locales";

// Owner decision (#10): one route tree for every language, app/[locale]/…. Adding a language = add it to LOCALES,
// add its message table (and data fields) — never a new set of route files.

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(web, "app");
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? [join(dir, e.name), ...walk(join(dir, e.name))] : [join(dir, e.name)]));
const rel = (p: string) => relative(app, p).split("\\").join("/");

describe("one route tree for every language", () => {
  const entries = walk(app).map(rel);

  it("app/ holds only the [locale] tree and the 404 page", () => {
    expect(readdirSync(app).sort()).toEqual(["[locale]", "global-not-found.tsx"]);
  });

  it("no directory is named after a language or a language group", () => {
    const names = entries.flatMap((e) => e.split("/"));
    for (const l of LOCALES) {
      expect(names, l).not.toContain(l);
      expect(names, l).not.toContain(`(${l})`);
    }
    expect(names.filter((n) => /^\(.*\)$/.test(n))).toEqual([]); // no route groups at all
  });

  it("no route file names a language: the locale always comes from the URL", () => {
    const files = entries.filter((e) => /\.tsx?$/.test(e) && e.startsWith("[locale]/"));
    expect(files.length).toBeGreaterThanOrEqual(10); // control: every page and layout is scanned
    const quoted = new RegExp(`["'\`](${LOCALES.join("|")})["'\`]`);
    expect(files.filter((f) => quoted.test(readFileSync(join(app, f), "utf-8")))).toEqual([]);
  });

  it("every page of the section exists once, under [locale]/hots", () => {
    const pages = entries.filter((e) => e.endsWith("/page.tsx")).sort();
    expect(pages).toEqual([
      "[locale]/hots/draft/page.tsx",
      "[locale]/hots/heroes/[slug]/page.tsx",
      "[locale]/hots/heroes/page.tsx",
      "[locale]/hots/maps/[slug]/page.tsx",
      "[locale]/hots/maps/page.tsx",
      "[locale]/hots/page.tsx",
      "[locale]/hots/players/page.tsx",
      "[locale]/hots/tier/page.tsx",
      "[locale]/page.tsx",
    ]);
  });

  it("the [locale] layout takes its params from LOCALES and refuses any other", () => {
    const layout = readFileSync(join(app, "[locale]", "layout.tsx"), "utf-8");
    expect(layout).toMatch(/generateStaticParams\s*=\s*localeParams/);
    expect(layout).toMatch(/dynamicParams\s*=\s*false/);
    expect(layout).toMatch(/<html lang=\{locale\}/);
  });
});
