"use client";

import { useEffect, useRef, useState } from "react";
import type { HeroTable } from "@/data";
import { useLocale, useT } from "@/i18n/client";
import { fetchHeroStats, HERO_STATS_MODES, heroStatsView, type HeroStatsMode, type HeroStatsResponse } from "@/lib/heroStats";
import type { ApiResult, Region } from "@/lib/players";
import { Card, cx, Portrait, Segmented, wrTone } from "../ui";

const int = (n: number) => Math.round(n).toLocaleString("ko-KR");
const one = (n: number) => n.toFixed(1);

/** 영웅별 통계 (#88): the player's games per hero, one mode at a time. A mode is asked for the first time it is shown,
 *  and nothing is asked until the section scrolls into view: the bucket is small (500/week on Intermediate). */
export function HeroStats({ tag, region, heroes }: { tag: string; region: Region; heroes: HeroTable }) {
  const t = useT();
  const s = t.players.heroStats;
  const locale = useLocale();
  const [mode, setMode] = useState<HeroStatsMode>("all");
  const [byMode, setByMode] = useState<Partial<Record<HeroStatsMode, ApiResult<HeroStatsResponse>>>>({});
  const [seen, setSeen] = useState(false);
  const asked = useRef(new Set<HeroStatsMode>());
  const box = useRef<HTMLDivElement>(null);
  const got = byMode[mode];
  useEffect(() => {
    const el = box.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  useEffect(() => {
    if (!seen || asked.current.has(mode)) return;
    asked.current.add(mode);
    void fetchHeroStats(tag, region, mode).then((r) => setByMode((b) => ({ ...b, [mode]: r })));
  }, [seen, mode, region, tag]);

  return (
    <div ref={box}>
    <Card aria-labelledby="h-hero-stats">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3">
        <div>
          <h2 id="h-hero-stats" className="text-[15px] font-bold text-fg">
            {s.title}
          </h2>
          <p className="text-2xs text-muted">{s.sub}</p>
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
      <div id="hero-stats" data-state={got === undefined ? "loading" : got.kind}>
        {got === undefined ? (
          <p className="px-4 py-3 text-xs text-muted">{s.loading}</p>
        ) : got.kind === "quota" ? (
          <p className="px-4 py-3 text-xs text-warn-fg">{s.quota}</p>
        ) : got.kind !== "ok" ? (
          <p className="px-4 py-3 text-xs text-muted">{s.error}</p>
        ) : got.data.heroes.length === 0 ? (
          <p className="px-4 py-3 text-xs text-muted">{s.empty}</p>
        ) : (
          <>
            {got.data.stale && <p className="border-b border-line bg-warn-bg px-4 py-2 text-2xs text-warn-fg">{s.stale}</p>}
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
                  {heroStatsView(got.data.heroes, heroes, locale).map((h) => (
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
                      <td className="px-2 py-1.5 text-right text-fg">{h.kda.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right text-fg-2">
                        {one(h.kills)} / {one(h.deaths)} / {one(h.assists)}
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
    </div>
  );
}
