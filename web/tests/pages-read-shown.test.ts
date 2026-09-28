import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const app = join(dirname(fileURLToPath(import.meta.url)), "..", "app");
const pages = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? pages(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : []));

describe("pages read snapshots through readShown", () => {
  // 2026-09-29: only the tier page had the thin-patch fallback; 홈 read the current file directly and went empty
  it("no page under app/ calls readSnapshot directly", () => {
    const files = pages(app);
    expect(files.length).toBeGreaterThan(5); // control: the walk finds the pages
    expect(files.filter((f) => readFileSync(f, "utf-8").includes("readSnapshot(")).map((f) => f.slice(app.length))).toEqual([]);
  });
});
