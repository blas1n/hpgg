import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const pages = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? pages(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : []));

describe("pages read snapshots through readShown", () => {
  // 2026-09-29: only the tier page had the thin-patch fallback; 홈 read the current file directly and went empty
  // the pages are written once in src/routes (#10); app/ only picks the language
  it("no page under app/ or src/routes calls readSnapshot directly", () => {
    const files = [...pages(join(web, "app")), ...pages(join(web, "src", "routes"))];
    expect(files.length).toBeGreaterThan(5); // control: the walk finds the pages
    expect(files.some((f) => f.endsWith("pages.tsx") && readFileSync(f, "utf-8").includes("readShown("))).toBe(true); // control: the page code is in the walk
    expect(files.filter((f) => readFileSync(f, "utf-8").includes("readSnapshot(")).map((f) => f.slice(web.length))).toEqual([]);
  });
});
