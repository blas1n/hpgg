import { describe, expect, it } from "vitest";
import { luckGrade } from "../src/lib/teamLuck";

// 팀운 (#90): a light line in the 최근 20경기 panel (owner 2026-10-06: "재미를 위한 지표니까 유쾌하게" — no MMR numbers,
// just 최고 / 좋음 / 보통 / 나쁨 / 극악) from the newest games' mean of teammates − opponents MMR before each game.

describe("luckGrade", () => {
  // the whole team against the opponents (server/players/teamluck.py); ±20 / ±50 over 20 games gave 10 / 21 / 39 / 20 / 10 %
  // on 200 player-games' gaps (owner 2026-10-06: "다 보통만 나오면 재미 없잖아")
  it("grades the mean gap into five words", () => {
    expect(luckGrade(120)).toBe("best");
    expect(luckGrade(50)).toBe("best");
    expect(luckGrade(49)).toBe("good");
    expect(luckGrade(20)).toBe("good");
    expect(luckGrade(19)).toBe("normal");
    expect(luckGrade(-19)).toBe("normal");
    expect(luckGrade(-20)).toBe("bad");
    expect(luckGrade(-49)).toBe("bad");
    expect(luckGrade(-50)).toBe("worst");
  });

  it("no game counted is no grade", () => {
    expect(luckGrade(null)).toBeNull();
  });

  it("under 10 games is no grade: a few games swing too far (one game read −421, 2026-10-06)", () => {
    expect(luckGrade(-421, 1)).toBeNull();
    expect(luckGrade(-60, 9)).toBeNull();
    expect(luckGrade(-60, 10)).toBe("worst");
  });
});

describe("carryTone (몇인분, owner 2026-10-06)", async () => {
  const { carryTone } = await import("../src/lib/teamLuck");
  it("1.3 or more is a carry, 0.7 or less is light, the rest is a share", () => {
    expect(carryTone(1.5)).toBe("carry");
    expect(carryTone(1.3)).toBe("carry");
    expect(carryTone(1.2)).toBe("share");
    expect(carryTone(0.8)).toBe("share");
    expect(carryTone(0.7)).toBe("light");
    expect(carryTone(null)).toBeNull();
  });
});
