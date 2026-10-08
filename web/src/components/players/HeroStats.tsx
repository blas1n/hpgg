"use client";

import { useMemo, useState } from "react";
import type { HeroTable } from "@/data";
import { useLocale, useT } from "@/i18n/client";
import { HERO_STATS_MODES, heroRowsFromMatches, heroStatsView, type HeroStatsMode } from "@/lib/heroStats";
import type { MatchesResult } from "@/lib/matches";
import { Card, cx, Portrait, Segmented, wrTone } from "../ui";

const DASH = "–";
const int = (n: number | null) => (n === null ? DASH : Math.round(n).toLocaleString("ko-KR"));
const one = (n: number | null) => (n === null ? DASH : n.toFixed(1));

/** 영웅별 통계 (#88): the player's newest games (the match list above) per hero, one mode at a time. Worked out on the
 *  page, so it asks Heroes Profile nothing (owner 2026-10-09: /players/heroes spent a 500-a-week bucket). */
export function HeroStats({ games, heroes }: { games: { kind: "loading" } | MatchesResult; heroes: HeroTable }) {
  const t = useT();
  const s = t.players.heroStats;
  const locale = useLocale();
  const [mode, setMode] = useState<HeroStatsMode>("all");
  const matches = games.kind === "ok" ? games.data.matches : null;
  const rows = useMemo(() => (matches ? heroRowsFromMatches(matches, mode) : []), [matches, mode]);
  const basic = games.kind === "ok" && games.data.source === "basic";

  return (
    <Card aria-labelledby="h-hero-stats">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3">
        <div>
          <h2 id="h-hero-stats" className="text-[15px] font-bold text-fg">
            {s.title}
          </h2>
          <p className="text-2xs text-muted">{s.sub(String(matches?.length ?? 0))}</p>
        </div>
        <div className="sm:ml-auto">
          <Segmented
            label={t.common.gameMode}
            idPrefix="hero-stats"
            value={mode}
            onChange={setMode}
            options={HERO_STATS_MODES.map((m) => ({ value: m, label: m === "all" ? s.all : t.common.modes[m] }))}
          />
        </div>
      </div>
      <div id="hero-stats" data-state={games.kind} data-source={basic ? "basic" : undefined}>
        {games.kind === "loading" ? (
          <p className="px-4 py-3 text-xs text-muted">{s.loading}</p>
        ) : games.kind !== "ok" ? (
          <p className="px-4 py-3 text-xs text-muted">{s.error}</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-3 text-xs text-muted">{s.empty}</p>
        ) : (
          <>
            {basic && <p className="border-b border-line bg-warn-bg px-4 py-2 text-2xs text-warn-fg">{s.basic}</p>}
            <div className="overflow-x-auto">
              <table className="num w-full min-w-[44rem] text-xs">
                <thead className="text-2xs text-muted">
                  <tr className="border-b border-line">
                    <th className="px-4 py-2 text-left font-semibold">{s.hero}</th>
                    <th className="px-2 py-2 text-right font-semibold">{s.games}</th>
                    <th className="px-2 py-2 text-right font-semibold">{s.winRate}</th>
                    <th className="px-2 py-2 text-right font-semibold">{s.kda}</th>
                    <th className="px-2 py-2 text-right font-semibold">{s.kdaAvg}</th>
                    <th className="px-2 py-2 text-right font-semibold">{s.heroDamage}</th>
                    <th className="px-2 py-2 text-right font-semibold">{s.siegeDamage}</th>
                    <th className="px-2 py-2 text-right font-semibold">{s.healing}</th>
                    <th className="px-2 py-2 text-right font-semibold">{s.damageTaken}</th>
                    <th className="px-4 py-2 text-right font-semibold">{s.experience}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {heroStatsView(rows, heroes, locale).map((h) => (
                    <tr key={h.name} data-hero={h.slug ?? undefined}>
                      <td className="px-4 py-1.5">
                        <span className="flex items-center gap-2">
                          <Portrait src={h.portrait} size={28} role={h.role} />
                          {h.href ? (
                            <a href={h.href} className="font-semibold text-fg hover:underline">
                              {h.name}
                            </a>
                          ) : (
                            <span className="font-semibold text-fg">{h.name}</span>
                          )}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right text-fg-2">{int(h.games)}</td>
                      <td className={cx("px-2 py-1.5 text-right font-semibold", wrTone(h.winRate))}>{one(h.winRate)}%</td>
                      <td className="px-2 py-1.5 text-right text-fg">{h.kda === null ? DASH : h.kda.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right text-fg-2">
                        {h.kills === null ? DASH : `${one(h.kills)} / ${one(h.deaths)} / ${one(h.assists)}`}
                      </td>
                      <td className="px-2 py-1.5 text-right text-fg-2">{int(h.heroDamage)}</td>
                      <td className="px-2 py-1.5 text-right text-fg-2">{int(h.siegeDamage)}</td>
                      <td className="px-2 py-1.5 text-right text-fg-2">{int(h.healing)}</td>
                      <td className="px-2 py-1.5 text-right text-fg-2">{int(h.damageTaken)}</td>
                      <td className="px-4 py-1.5 text-right text-fg-2">{int(h.experience)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
