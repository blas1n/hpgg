/** Which heroes a page shows: only those our asset table (heroes_ko.json — Korean name, portrait, talents) has.
 *  A hero that reaches the stats first (a new release) is dropped here, before any tier cut, so tiers are computed
 *  over the heroes on the page. It appears by itself once tools/build_assets.py is rerun with game data that has it.
 *  Applied by both snapshot entry points: pickShown (build time) and loadSnapshot (tier page, in the browser). */
import type { Snapshot } from "../formula";
import type { HeroTable } from "../data";

export function knownOnly(snap: Snapshot, heroes: HeroTable): Snapshot {
  const known = new Set(heroes.heroes.map((h) => h.name));
  return { ...snap, rows: snap.rows.filter((r) => known.has(r.hero)) };
}
