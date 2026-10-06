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
