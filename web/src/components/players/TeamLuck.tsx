"use client";

import { useEffect, useRef, useState } from "react";
import type { HeroTable } from "@/data";
import { useLocale, useT } from "@/i18n/client";
import type { ApiResult, Region } from "@/lib/players";
import { fetchTeamLuck, LUCK, TEAM_LUCK_MODES, teamLuckView, type TeamLuckMode, type TeamLuckResponse } from "@/lib/teamLuck";
import { Card, cx, Segmented } from "../ui";

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(Math.round(n)).toLocaleString("ko-KR")}`;
const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(0)}%`);

/** 팀운 (#90): the newest 20 games' teammates − opponents MMR before each game. One replay call per game not cached,
 *  so nothing is asked until the card scrolls into view, and a mode only the first time it is shown. */
export function TeamLuck({ tag, region, heroes }: { tag: string; region: Region; heroes: HeroTable }) {
  const t = useT();
  const s = t.players.teamLuck;
  const locale = useLocale();
  const [mode, setMode] = useState<TeamLuckMode>("all");
  const [byMode, setByMode] = useState<Partial<Record<TeamLuckMode, ApiResult<TeamLuckResponse>>>>({});
  const [seen, setSeen] = useState(false);
  const asked = useRef(new Set<TeamLuckMode>());
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
    void fetchTeamLuck(tag, region, mode).then((r) => setByMode((b) => ({ ...b, [mode]: r })));
  }, [seen, mode, region, tag]);
  const v = got?.kind === "ok" ? teamLuckView(got.data, heroes, locale) : null;

  return (
    <div ref={box}>
      <Card aria-labelledby="h-team-luck">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3">
          <div>
            <h2 id="h-team-luck" className="text-[15px] font-bold text-fg">
              {s.title}
            </h2>
            <p className="text-2xs text-muted">{s.sub}</p>
          </div>
          <div className="sm:ml-auto">
            <Segmented
              label={t.common.gameMode}
              idPrefix="team-luck"
              value={mode}
              onChange={setMode}
              options={TEAM_LUCK_MODES.map((m) => ({ value: m, label: m === "all" ? s.all : t.common.modes[m] }))}
            />
          </div>
        </div>
        <div id="team-luck" data-state={got === undefined ? "loading" : got.kind}>
          {got === undefined ? (
            <p className="px-4 py-3 text-xs text-muted">{s.loading}</p>
          ) : got.kind === "quota" ? (
            <p className="px-4 py-3 text-xs text-warn-fg">{s.quota}</p>
          ) : got.kind !== "ok" ? (
            <p className="px-4 py-3 text-xs text-muted">{s.error}</p>
          ) : v === null ? (
            <p className="px-4 py-3 text-xs text-muted">{s.empty}</p>
          ) : (
            <>
              {v.partial && <p className="border-b border-line bg-warn-bg px-4 py-2 text-2xs text-warn-fg">{s.partial}</p>}
              <div className="grid gap-4 px-4 py-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
                <div className="space-y-1">
                  <div className="text-2xs text-muted">{s.gapAvg}</div>
                  <div
                    id="team-luck-gap"
                    data-verdict={v.verdict}
                    className={cx("num text-3xl font-black", v.verdict === "good" ? "text-pos" : v.verdict === "bad" ? "text-neg" : "text-fg")}
                  >
                    {signed(v.gapAvg)}
                  </div>
                  <div className="text-xs text-fg-2">{s.verdict[v.verdict]}</div>
                  <div className="num text-2xs text-muted">{s.basis(String(v.games))}</div>
                </div>
                <dl className="num grid grid-cols-3 gap-2 text-center text-xs">
                  {(["good", "even", "bad"] as const).map((k) => (
                    <div key={k} data-luck={k} className="rounded border border-line px-2 py-2">
                      <dt className="text-2xs text-muted">{s[k]}</dt>
                      <dd className="mt-1 font-semibold text-fg">{v[k].games ? s.record(String(v[k].games), pct(v[k].winRate)) : s.noGames}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="border-t border-line px-4 py-3">
                <h3 className="mb-2 text-2xs font-semibold text-muted">{s.perGame}</h3>
                <ol id="team-luck-games" className="space-y-1">
                  {v.rows.map((r) => (
                    <li key={r.id} data-win={r.win} className="grid grid-cols-[6.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-2xs">
                      <span className="truncate text-fg-2">
                        <span className={cx("mr-1 font-bold", r.win ? "text-pos" : "text-neg")}>{r.win ? "W" : "L"}</span>
                        {r.hero}
                      </span>
                      <span className="relative h-2 rounded bg-line/60" aria-hidden>
                        <span
                          className={cx("absolute top-0 h-2 rounded", r.gap >= 0 ? "left-1/2 bg-pos" : "right-1/2 bg-neg")}
                          style={{ width: `${Math.abs(r.bar) * 50}%` }}
                        />
                      </span>
                      <span className="num text-right text-fg">{signed(r.gap)}</span>
                    </li>
                  ))}
                </ol>
                <p className="mt-3 text-2xs leading-relaxed text-muted">{s.formula(String(LUCK))}</p>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
