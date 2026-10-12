import { describe, expect, it } from "vitest";
import { LENGTH_MIN_GAMES, lengthView, type LengthFile } from "../src/lib/length";

// collector/hero_length.py's output (data/latest/sl_length.json)
const file: LengthFile = {
  patch: "2.57.0",
  since: "2.57.0.98348",
  collected_at: "2026-10-12T18:40:00Z",
  games: 4185,
  bands: { short: 927, mid: 1817, long: 1441 },
  heroes: {
    Abathur: { short: { games: 150, wins: 57 }, mid: { games: 260, wins: 130 }, long: { games: 200, wins: 110 }, lean: "late" },
    Medivh: { short: { games: 20, wins: 4 }, mid: { games: 80, wins: 32 }, long: { games: 60, wins: 28 }, lean: null },
  },
};
const window = { since: "2.57.0.98348", since_at: "2026-10-05T17:12:19Z", pending: null };

describe("lengthView", () => {
  it("gives the hero's win rate per band, shortest first, with the sample it stands on", () => {
    const v = lengthView(file, "Abathur", window)!;
    expect(v.bands.map((b) => b.band)).toEqual(["short", "mid", "long"]);
    expect(v.bands[0]).toEqual({ band: "short", games: 150, winRate: 38 });
    expect(v.bands[2]!.winRate).toBeCloseTo(55);
    expect(v.games).toBe(610);
    expect(v.sample).toBe(4185);
    expect(v.patch).toBe("2.57.0");
    expect(v.lean).toBe("late");
  });

  it("names the day of the hotfix the count starts from (Korean time), when it is the meta's window", () => {
    expect(lengthView(file, "Abathur", window)!.sinceDay).toBe("10/6");
    expect(lengthView({ ...file, since: null }, "Abathur", window)!.sinceDay).toBeNull();
    expect(lengthView(file, "Abathur", undefined)!.sinceDay).toBeNull();
  });

  it(`shows no rate for a band under ${LENGTH_MIN_GAMES} games`, () => {
    const v = lengthView(file, "Medivh", window)!;
    expect(v.bands[0]).toEqual({ band: "short", games: 20, winRate: null });
    expect(v.bands[1]!.winRate).toBe(40);
  });

  it("is null without the file or without the hero in it", () => {
    expect(lengthView(null, "Abathur", window)).toBeNull();
    expect(lengthView(file, "Valla", window)).toBeNull();
  });
});
