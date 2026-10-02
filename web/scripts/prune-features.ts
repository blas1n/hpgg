/**
 * After `next build`: removes the sections of switched-off features (src/features.ts) from the export in every
 * language, so GitHub Pages answers them with its 404 page. Runs under Node (type stripping) and in vitest: value
 * imports carry their .ts extension.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { disabledSections, FEATURES, type Flags } from "../src/features.ts";
import { LOCALES } from "../src/i18n/locales.ts";

/** Returns the removed paths, relative to `dist`. */
export function pruneDisabled(dist: string, flags: Flags = FEATURES): string[] {
  const removed: string[] = [];
  for (const section of disabledSections(flags)) {
    for (const l of LOCALES) {
      const rel = `${l}/hots/${section}`;
      if (!existsSync(join(dist, rel))) continue;
      rmSync(join(dist, rel), { recursive: true, force: true });
      removed.push(rel);
    }
  }
  return removed;
}
