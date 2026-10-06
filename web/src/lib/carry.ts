/** 몇인분 (owner 2026-10-06: "졌을 때도 1.5인분 했다면서 웃을 수 있잖아"; "같은 영웅 평균으로 봐야", "종합적으로").
 *
 *  Each teammate is measured against the same hero's usual output per minute (data/carry_baselines.json, from the daily
 *  replay sample, collector/carry_baselines.py; a hero with too few games uses its role's): takedowns, hero damage,
 *  siege damage, experience, healing + damage taken, crowd control, shields, camps and towers, and time dead (less is
 *  more). Each stat's ratio, capped at 2.5, is squared and weighted by how much that stat is the hero's job (√ of the
 *  hero's usual against every hero's) — a bruiser's soak, a healer's healing count most for them. The player's share
 *  of the team's sum × 5 is the 몇인분: the team adds up to 5, an average teammate is 1.0.
 *
 *  Checked on 4,010 Storm League player-games (w41, 2026-10-06): the middle 90 % is 0.56–1.55, 1.5+ is 6.3 %, and the
 *  roles' medians sit within 0.14 of each other (healer 0.96, tank 0.94, ranged assassin 0.99). */

export type CarryStat = "td" | "dmg" | "siege" | "xp" | "sus" | "cc" | "prot" | "map" | "dead";
type PerMin = Record<CarryStat, number>;
export interface CarryBaselines {
  heroes: Record<string, { games: number; per_min: PerMin }>;
  roles: Record<string, { games: number; per_min: PerMin }>;
  all: PerMin;
}
/** a teammate as /v1/players/teamluck carries it */
export interface CarryPlayer {
  hero: string | null;
  role: string | null;
  me: boolean;
  stats: Record<string, number>;
}

const CAP = 2.5;
// time dead: a few seconds of slack so a deathless game is not infinitely good
const DEAD_SLACK = 0.5;

const output = (s: Record<string, number>): PerMin => {
  const g = (k: string) => Number(s[k] ?? 0);
  return {
    td: g("takedowns"),
    dmg: g("hero_damage"),
    siege: g("siege_damage"),
    xp: g("experience"),
    sus: g("healing") + g("damage_taken"),
    cc: g("stuns") + g("roots") + g("silences"),
    prot: g("shields"),
    map: g("merc_camps") + g("towers"),
    dead: g("time_spent_dead"),
  };
};

function impact(p: CarryPlayer, minutes: number, b: CarryBaselines): number | null {
  const own = (p.hero && b.heroes[p.hero]) || (p.role && b.roles[p.role]);
  if (!own) return null;
  const usual = own.per_min;
  const did = output(p.stats);
  let sum = 0;
  let weights = 0;
  for (const k of Object.keys(usual) as CarryStat[]) {
    const per = did[k] / minutes;
    if (k === "dead") {
      const r = Math.min((usual.dead + DEAD_SLACK) / (per + DEAD_SLACK), CAP);
      sum += r * r;
      weights += 1;
      continue;
    }
    if (!(usual[k] > 0) || !(b.all[k] > 0)) continue;
    const w = Math.sqrt(usual[k] / b.all[k]);
    const r = Math.min(per / usual[k], CAP);
    sum += w * r * r;
    weights += w;
  }
  return weights ? sum / weights : null;
}

/** The marked player's 몇인분 in their team, to one decimal; null when it cannot be told. */
export function carryOf(team: CarryPlayer[], lengthS: number | null, b: CarryBaselines | null): number | null {
  if (!b || !lengthS || !team.some((p) => p.me)) return null;
  const minutes = Math.max(lengthS / 60, 1);
  const imps = team.map((p) => impact(p, minutes, b));
  if (imps.some((x) => x === null)) return null;
  const total = imps.reduce<number>((s, x) => s + (x ?? 0), 0);
  const mine = imps[team.findIndex((p) => p.me)]!;
  return total > 0 ? Math.round(((mine * team.length) / total) * 10) / 10 : null;
}
