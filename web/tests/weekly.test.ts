import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { HeroTable } from "../src/data";
import type { Row, Snapshot } from "../src/formula";
import { weekDays, weeklyModel, type WeeklyIssue } from "../src/lib/weekly";

// 주간 메타 리포트 (owner 2026-10-05): one issue a week — the week's own games (collector/weekly.py), ranked by the
// site's tier formula, against the week before or, in a patch's first week, the previous patch.

const here = dirname(fileURLToPath(import.meta.url));
const heroes = JSON.parse(readFileSync(join(here, "..", "..", "data", "heroes_ko.json"), "utf-8")) as HeroTable;

const row = (hero: string, games: number, wins: number, pick: number): Row => ({ hero, map: "all", wins, losses: games - wins, games, bans: 0, pick, popularity: pick, win_rate: (wins / games) * 100, ban_rate: 0, ci: null, tier_win_rate: (wins / games) * 100 });
const snap = (rows: Row[], matches = 1000): Snapshot => ({ patch: "2.57.0", mode: "qm", game_type: "qm", league_tier: null, region: null, collected_at: "2026-10-12T18:20:00Z", matches, rows });

const window = snap([row("Valla", 400, 240, 40), row("Illidan", 300, 135, 30), row("Muradin", 200, 104, 20), row("Xal'atath", 300, 210, 30)]);
const baseline = snap([row("Valla", 400, 180, 40), row("Illidan", 300, 180, 30), row("Muradin", 200, 104, 20)]);
const issue: WeeklyIssue = {
  week: "2026-w41",
  kind: "week",
  start: "2026-10-05",
  end: "2026-10-12",
  patch: "2.57.0",
  collected_at: "2026-10-11T18:20:00Z",
  baseline: { kind: "week", week: "2026-w40" },
  views: { qm: { window, baseline }, sl: { window, baseline: null } },
  daily: {
    qm: [
      { day: "2026-10-06", heroes: { Valla: [50, 30], "Xal'atath": [40, 30] } },
      { day: "2026-10-07", heroes: { Valla: [5, 5], "Xal'atath": [50, 33] } },
    ],
    sl: [],
  },
};
const m = weeklyModel(issue, heroes, 50, ["2026-w41", "2026-w40"]);

describe("weeklyModel", () => {
  it("covers Monday to Sunday of the week", () => {
    expect(weekDays("2026-w41")).toEqual({ monday: "2026-10-05", sunday: "2026-10-11" });
    expect(m.monday).toBe("2026-10-05");
    expect(m.sunday).toBe("2026-10-11");
  });

  it("ranks the week by the tier formula and gives each hero its rank change against the baseline", () => {
    const qm = m.modes.qm!;
    expect(qm.top[0]!.hero.name).toBe("Xal'atath");
    const valla = qm.top.find((r) => r.hero.name === "Valla")!;
    expect(valla.prevRank).not.toBeNull();
    expect(valla.delta).toBe(valla.prevRank! - valla.rank);
    expect(valla.prevWr).toBeCloseTo(45);
    expect(valla.wr).toBeCloseTo(60);
  });

  it("climbers and fallers are heroes ranked in both, biggest move first; new heroes are apart", () => {
    const qm = m.modes.qm!;
    expect(qm.up[0]!.hero.name).toBe("Valla");
    expect(qm.down[0]!.hero.name).toBe("Illidan");
    expect(qm.up.concat(qm.down).some((r) => r.hero.name === "Xal'atath")).toBe(false);
    expect(qm.fresh.map((r) => r.hero.name)).toEqual(["Xal'atath"]);
  });

  it("the headline names the biggest climb, the biggest fall and the most played hero", () => {
    const h = m.modes.qm!.headline;
    expect(h.up?.hero.name).toBe("Valla");
    expect(h.down?.hero.name).toBe("Illidan");
    expect(h.mostPlayed?.hero.name).toBe("Valla"); // 400 games
  });

  it("daily win rates for the heroes the issue points at; a thin day is a gap, not a number", () => {
    const d = m.modes.qm!.daily;
    expect(d.days).toEqual(["2026-10-06", "2026-10-07"]);
    const valla = d.series.find((s) => s.hero.name === "Valla")!;
    expect(valla.wr[0]).toBeCloseTo(60);
    expect(valla.wr[1]).toBeNull(); // 5 games
    expect(d.series.find((s) => s.hero.name === "Xal'atath")!.wr[1]).toBeCloseTo(66);
  });

  it("without a baseline there are no ranks before and no climbers", () => {
    const sl = m.modes.sl!;
    expect(sl.top.every((r) => r.prevRank === null && r.delta === null)).toBe(true);
    expect(sl.up).toEqual([]);
    expect(sl.fresh).toEqual([]); // nothing to be new against
  });

  it("links the issues before and after", () => {
    expect(m.newer).toBeNull();
    expect(m.older).toBe("2026-w40");
  });

  it("reads the real first issue (2.57.0's first week) without surprises", () => {
    const real = JSON.parse(readFileSync(join(here, "..", "..", "data", "weekly", "2026-w40.json"), "utf-8")) as WeeklyIssue;
    const r = weeklyModel(real, heroes, 50, ["2026-w40"]);
    expect(r.kind).toBe("patch_start");
    expect(r.modes.qm!.fresh.map((x) => x.hero.name)).toContain("Xal'atath");
    expect(r.modes.qm!.top).toHaveLength(10);
  });
});
