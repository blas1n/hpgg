import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { appliedParty, formulaDetail, formulaLine, computeTiers, scoreRow, shrinkWinRate, type Row, type Snapshot } from "../src/formula";
import { wilson } from "../src/wilson";

const here = dirname(fileURLToPath(import.meta.url));
const load = (f: string): Snapshot => JSON.parse(readFileSync(join(here, "fixtures", f), "utf-8")) as Snapshot;
const sl = load("sl_2026-09-28.json");
const qm = load("qm_2026-09-28.json");
const allRows = (s: Snapshot): Row[] => s.rows.filter((r) => r.map === "all");
const tierOf = (s: Snapshot) => {
  const t = computeTiers(allRows(s), 200);
  return Object.fromEntries(t.ranked.map((x) => [x.row.hero, x.tier]));
};
const rankOf = (s: Snapshot, hero: string) => computeTiers(allRows(s), 200).ranked.findIndex((x) => x.row.hero === hero) + 1;

describe("shrinkWinRate", () => {
  it("pulls small samples toward 50 with k=500", () => {
    expect(shrinkWinRate(60, 500, 500)).toBeCloseTo(55, 6);
    expect(shrinkWinRate(60, 1_000_000, 500)).toBeCloseTo(60, 2);
    expect(shrinkWinRate(40, 0, 500)).toBe(50);
  });
});

describe("scoreRow", () => {
  it("is pick × (WRs − 50) × 3 + ban", () => {
    const r: Row = { hero: "X", map: "all", wins: 550, losses: 450, games: 1000, bans: 0, pick: 20, popularity: 20, win_rate: 55, ban_rate: 10, ci: null };
    const wrs = shrinkWinRate(55, 1000, 500); // 53.333
    expect(scoreRow(r)).toBeCloseTo(20 * (wrs - 50) * 3 + 10, 6);
  });
  it("QM rows have no ban term", () => {
    const r: Row = { hero: "X", map: "all", wins: 550, losses: 450, games: 1000, bans: 0, pick: 20, popularity: 20, win_rate: 55, ban_rate: 0, ci: null };
    expect(scoreRow(r)).toBeCloseTo(20 * (shrinkWinRate(55, 1000, 500) - 50) * 3, 6);
  });
});

describe("design-doc verification table (2026-09-28 fixtures)", () => {
  const expected: Record<string, [string, string]> = {
    Qhira: ["S", "S"], Johanna: ["S", "A"], Rehgar: ["S", "B"], Falstad: ["A", "A"], Illidan: ["A", "B"],
    Azmodan: ["A", "S"], Abathur: ["A", "S"], Gazlowe: ["A", "B"], Samuro: ["B", "B"], Anduin: ["B", "B"],
    Brightwing: ["F", "A"], Stitches: ["F", "D"], Diablo: ["F", "F"],
  };
  const tSl = tierOf(sl);
  const tQm = tierOf(qm);
  for (const [hero, [eSl, eQm]] of Object.entries(expected)) {
    it(`${hero}: SL ${eSl}, QM ${eQm}`, () => {
      expect(tSl[hero]).toBe(eSl);
      expect(tQm[hero]).toBe(eQm);
    });
  }
  it("ranks match the table", () => {
    expect(rankOf(sl, "Qhira")).toBe(1);
    expect(rankOf(sl, "Illidan")).toBe(11);
    expect(rankOf(sl, "Brightwing")).toBe(87);
    expect(rankOf(qm, "Azmodan")).toBe(3);
    expect(rankOf(qm, "Illidan")).toBe(35);
  });
  it("N=90 boundaries are 5/21/48/73/84 → S5 A16 B27 C25 D11 F6", () => {
    const t = computeTiers(allRows(sl), 200);
    const count = (tier: string) => t.ranked.filter((x) => x.tier === tier).length;
    expect([count("S"), count("A"), count("B"), count("C"), count("D"), count("F")]).toEqual([5, 16, 27, 25, 11, 6]);
    expect(t.grey).toHaveLength(0);
  });
});

describe("cuts and grey rows", () => {
  const mk = (hero: string, games: number, wr: number, pick = 10): Row => ({
    hero, map: "all", wins: Math.round((games * wr) / 100), losses: games - Math.round((games * wr) / 100), games, bans: 0, pick, popularity: pick, win_rate: wr, ban_rate: 0, ci: null,
  });
  it("rows under 200 games are grey and excluded from the denominator", () => {
    const rows = [mk("A", 1000, 55), mk("B", 199, 70), mk("C", 1000, 45)];
    const t = computeTiers(rows, 200);
    expect(t.grey.map((r) => r.hero)).toEqual(["B"]);
    expect(t.ranked.map((x) => x.row.hero)).toEqual(["A", "C"]);
  });
  it("monotonic cuts: N=3 gives S/A/B one each, C/D/F empty", () => {
    const rows = [mk("A", 1000, 55), mk("B", 1000, 52), mk("C", 1000, 48)];
    const t = computeTiers(rows, 200);
    expect(t.ranked.map((x) => x.tier)).toEqual(["S", "A", "B"]);
  });
  it("N=12 synthetic map keeps every tier non-empty until it runs out", () => {
    const rows = Array.from({ length: 12 }, (_, i) => mk(`H${i}`, 1000, 60 - i));
    const tiers = computeTiers(rows, 200).ranked.map((x) => x.tier);
    expect(tiers).toEqual(["S", "A", "B", "B", "B", "B", "C", "C", "C", "D", "D", "F"]);
  });
});

describe("wilson", () => {
  it("95% half-width for 500/1000 is about 3.1 points", () => {
    const [lo, hi] = wilson(500, 1000);
    expect((hi - lo) / 2).toBeCloseTo(3.1, 1);
    expect(lo).toBeLessThan(50);
    expect(hi).toBeGreaterThan(50);
  });
  it("handles zero games", () => {
    expect(wilson(0, 0)).toEqual([0, 100]);
  });
});

describe("printed formula", () => {
  it("the Korean text is exactly what the page printed before presets existed", () => {
    expect(formulaLine(true, "ko")).toBe("티어 점수 = 픽률 × (승률 − 50) × 3 + 밴률 × 1");
    expect(formulaLine(false, "ko")).toBe("티어 점수 = 픽률 × (승률 − 50) × 3");
    expect(formulaDetail(true, 200, "ko")).toBe(`WRs   = 50 + (승률 − 50) × 게임수 / (게임수 + 500)
점수  = 픽률 × (WRs − 50) × 3 + 밴률 × 1
티어  = 200게임 이상인 영웅을 점수순으로 세워 누적 비율로 자름 (S 6% · A 24% · B 54% · C 82% · D 94% · F 나머지)
        경계는 단조 증가, 티어마다 최소 1명
승률 ± 는 Wilson 95% 구간. 전장을 고르면 그 전장의 표본으로만 계산합니다.
같은 데이터라도 공식이 다르면 티어가 다릅니다. 이 사이트는 공식을 숨기지 않습니다.`);
    expect(formulaDetail(false, 200, "ko")).toContain("점수  = 픽률 × (WRs − 50) × 3   (빠른 대전은 밴이 없음)");
  });

  it("prints the same formula in English, with the same numbers", () => {
    expect(formulaLine(true, "en")).toBe("tier score = pick rate × (win rate − 50) × 3 + ban rate × 1");
    expect(formulaLine(false, "en")).toBe("tier score = pick rate × (win rate − 50) × 3");
    const d = formulaDetail(false, 200, "en");
    expect(d).toContain("WRs   = 50 + (win rate − 50) × games / (games + 500)");
    expect(d).toContain("score = pick rate × (WRs − 50) × 3   (Quick Match has no bans)");
    expect(d).toContain("heroes with 200+ games");
    expect(d).toContain("S 6% · A 24% · B 54% · C 82% · D 94%");
  });
});

describe("party correction (#36): the collector's tier_win_rate is the formula's win-rate input", () => {
  const base: Row = { hero: "X", map: "all", wins: 550, losses: 450, games: 1000, bans: 0, pick: 20, popularity: 20, win_rate: 55, ban_rate: 0, ci: null };
  const party = { k: 1000, solo_pooled: 48.6312, solo_games: 265875 };

  it("scoreRow reads tier_win_rate when the row has one, win_rate otherwise", () => {
    expect(scoreRow({ ...base, tier_win_rate: 52 })).toBeCloseTo(20 * (shrinkWinRate(52, 1000, 500) - 50) * 3, 6);
    expect(scoreRow(base)).toBeCloseTo(20 * (shrinkWinRate(55, 1000, 500) - 50) * 3, 6);
  });

  it("appliedParty: the snapshot's party block only when the rows being ranked carry the correction", () => {
    const snap: Snapshot = { ...qm, party, rows: [{ ...base, tier_win_rate: 52 }, { ...base, map: "Cursed Hollow" }] };
    expect(appliedParty(snap, snap.rows.filter((r) => r.map === "all"))).toEqual(party);
    expect(appliedParty(snap, snap.rows.filter((r) => r.map === "Cursed Hollow"))).toBeNull();
    expect(appliedParty(qm, allRows(qm))).toBeNull();
  });

  it("the printed details say how the win rate was corrected, with the numbers used", () => {
    const ko = formulaDetail(false, 200, "ko", party);
    expect(ko).toContain("보정승률 = 승률 + (솔로승률 + 1.37 − 승률) × 솔로게임수 / (솔로게임수 + 1000)");
    expect(ko).toContain("WRs   = 50 + (보정승률 − 50) × 게임수 / (게임수 + 500)");
    expect(ko).toContain("48.63%");
    const en = formulaDetail(false, 200, "en", party);
    expect(en).toContain("corrected WR = win rate + (solo WR + 1.37 − win rate) × solo games / (solo games + 1000)");
    expect(en).toContain("WRs   = 50 + (corrected WR − 50) × games / (games + 500)");
    // without the correction the text is exactly what it was
    expect(formulaDetail(false, 200, "ko", null)).toBe(formulaDetail(false, 200, "ko"));
  });
});
