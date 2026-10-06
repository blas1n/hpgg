import { describe, expect, it } from "vitest";
import { luckGrade } from "../src/lib/teamLuck";

// 팀운 (#90): a light line in the 최근 20경기 panel (owner 2026-10-06: "재미를 위한 지표니까 유쾌하게" — no MMR numbers,
// just 최고 / 좋음 / 보통 / 나쁨 / 극악) from the newest games' mean of teammates − opponents MMR before each game.

describe("luckGrade", () => {
  it("grades the mean gap into five words", () => {
    expect(luckGrade(120)).toBe("best");
    expect(luckGrade(80)).toBe("best");
    expect(luckGrade(45)).toBe("good");
    expect(luckGrade(30)).toBe("good");
    expect(luckGrade(29)).toBe("normal");
    expect(luckGrade(-29)).toBe("normal");
    expect(luckGrade(-30)).toBe("bad");
    expect(luckGrade(-79)).toBe("bad");
    expect(luckGrade(-80)).toBe("worst");
  });

  it("no game counted is no grade", () => {
    expect(luckGrade(null)).toBeNull();
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
