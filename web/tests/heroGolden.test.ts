/** The owner MCP recomputes these hero-page views in Python (server/mcp/hero.py). Both check the same expected output,
 *  written from web/src/lib: change a view's rule here, regenerate `expected` (see the fixture's `_about`), and the
 *  Python test tells the other copy to follow. */
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { heroStrength, matchupsView } from "../src/lib/matchups";
import { heroBuilds } from "../src/lib/hero";
import { tiersView } from "../src/lib/tiers";
import { lengthView } from "../src/lib/length";

const path = fileURLToPath(new URL("../../tests/fixtures/hero_views_golden.json", import.meta.url));
const g = JSON.parse(readFileSync(path, "utf8"));
// UPDATE_MCP_GOLDEN=1 npx vitest run tests/heroGolden.test.ts rewrites `expected` from these views
const update = !!process.env.UPDATE_MCP_GOLDEN;
const pick = (r: { hero: string; games: number; win_rate: number; expected: number; delta: number; score: number }) => ({
  hero: r.hero,
  games: r.games,
  win_rate: r.win_rate,
  expected: r.expected,
  delta: r.delta,
  score: r.score,
});

describe("shared golden hero views (tests/fixtures/hero_views_golden.json)", () => {
  const strength = heroStrength({ rows: g.strength_rows } as never);
  for (const hero of g.heroes as string[]) {
    it(`${hero} as recorded`, () => {
      const m = matchupsView(g.matchups[hero], { heroes: [] } as never, strength)!;
      const b = heroBuilds(g.builds, null, hero, "ko");
      const got = {
        matchups: { counters: m.counters.map(pick), synergies: m.synergies.map(pick) },
        builds: Object.fromEntries(Object.entries(b).map(([k, list]) => [k, list!.map((x) => ({ games: x.games, win_rate: x.win_rate, pick: x.pick, thin: x.thin, talents: x.talents.map((t) => t.ko) }))])),
        tiers: tiersView(g.tiers, hero),
        length: lengthView(g.length, hero, g.window),
      };
      if (update) {
        g.expected = { ...g.expected, [hero]: got };
        writeFileSync(path, JSON.stringify(g, null, 1) + "\n");
      }
      expect(JSON.parse(JSON.stringify(got))).toEqual(g.expected[hero]);
    });
  }
});
