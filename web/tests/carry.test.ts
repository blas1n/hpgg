import { describe, expect, it } from "vitest";
import { carryOf, type CarryBaselines, type CarryPlayer } from "../src/lib/carry";

// 몇인분 (owner 2026-10-06): each teammate against the same hero's usual output per minute (data/carry_baselines.json,
// collector/carry_baselines.py) — what matters for that hero weighing more — then the player's share of the team × 5.

const per = (o: Partial<Record<string, number>>) => ({ td: 0.5, dmg: 2000, siege: 2000, xp: 500, sus: 2000, cc: 1, prot: 0, map: 0.1, dead: 3, ...o });
const baselines: CarryBaselines = {
  heroes: {
    Valla: { games: 500, per_min: per({ dmg: 3000 }) },
    Muradin: { games: 500, per_min: per({ dmg: 1200, sus: 4000, cc: 3 }) },
    Uther: { games: 500, per_min: per({ dmg: 800, sus: 5000, prot: 300 }) },
  },
  roles: { Tank: { games: 2000, per_min: per({ dmg: 1100, sus: 3800, cc: 3 }) } },
  all: per({}),
};

// a player who did exactly their hero's usual in a 10-minute game
const usual = (hero: string, role: string, me = false, scale: Partial<Record<string, number>> = {}): CarryPlayer => {
  const b = (baselines.heroes[hero] ?? baselines.roles[role]!).per_min;
  const m = (k: string) => b[k as keyof typeof b] * 10 * (scale[k] ?? 1);
  return {
    hero,
    role,
    me,
    stats: {
      takedowns: m("td"),
      hero_damage: m("dmg"),
      siege_damage: m("siege"),
      experience: m("xp"),
      healing: m("sus") / 2,
      damage_taken: m("sus") / 2,
      stuns: m("cc"),
      roots: 0,
      silences: 0,
      shields: m("prot"),
      merc_camps: m("map"),
      towers: 0,
      time_spent_dead: m("dead"),
    },
  };
};

describe("carryOf", () => {
  it("a team that each did their hero's usual is one each", () => {
    const team = [usual("Valla", "Ranged Assassin", true), usual("Muradin", "Tank"), usual("Uther", "Healer"), usual("Valla", "Ranged Assassin"), usual("Muradin", "Tank")];
    expect(carryOf(team, 600, baselines)).toBe(1);
  });

  it("twice the hero's usual damage and siege stands out; everyone else gives some of it up", () => {
    const team = [usual("Valla", "Ranged Assassin", true, { dmg: 2, siege: 2 }), usual("Muradin", "Tank"), usual("Uther", "Healer"), usual("Valla", "Ranged Assassin"), usual("Muradin", "Tank")];
    expect(carryOf(team, 600, baselines)!).toBeGreaterThanOrEqual(1.3);
  });

  it("a healer is judged by a healer's job: twice Uther's usual healing is a carry though the damage is low", () => {
    const team = [usual("Uther", "Healer", true, { sus: 2 }), usual("Muradin", "Tank"), usual("Valla", "Ranged Assassin"), usual("Valla", "Ranged Assassin"), usual("Muradin", "Tank")];
    expect(carryOf(team, 600, baselines)!).toBeGreaterThan(1.1);
  });

  it("a hero without its own yardstick uses its role's", () => {
    const team = [usual("Diablo", "Tank", true), usual("Muradin", "Tank"), usual("Uther", "Healer"), usual("Valla", "Ranged Assassin"), usual("Valla", "Ranged Assassin")];
    expect(carryOf(team, 600, baselines)).toBe(1);
  });

  it("no yardstick, no length or no player marked is nothing", () => {
    const team = [usual("Valla", "Ranged Assassin", true)];
    expect(carryOf(team, 600, null)).toBeNull();
    expect(carryOf(team, null, baselines)).toBeNull();
    expect(carryOf([usual("Valla", "Ranged Assassin")], 600, baselines)).toBeNull();
  });
});
