"use client";

import { useEffect, useState } from "react";
import { hotsHref, type Mode } from "@/data";
import { useLocale, useT } from "@/i18n/client";
import type { WeeklyModeModel, WeeklyModel, WeeklyRow } from "@/lib/weekly";
import { DAILY_MIN_GAMES } from "@/lib/weekly";
import { PageHead } from "@/components/PageHead";
import { CommentThread } from "@/components/comments/CommentThread";
import { Card, CardHeader, cx, Portrait, RankDelta, Segmented, TierBadge } from "../ui";

const pct = (n: number) => `${n.toFixed(1)}%`;
const int = (n: number) => n.toLocaleString("ko-KR");
const wrClass = (wr: number) => (wr >= 50 ? "text-pos" : "text-neg");
const md = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;

/** 주간 메타 리포트: one issue; the mode toggle swaps the pre-rendered modes (each mode is its own numbers). */
export function WeeklyView({ model }: { model: WeeklyModel | null }) {
  const t = useT();
  const href = hotsHref(useLocale());
  const [mode, setMode] = useState<Mode>("qm");
  useEffect(() => {
    if (new URLSearchParams(location.search).get("mode") === "sl") setMode("sl");
  }, []);
  const change = (m: Mode) => {
    setMode(m);
    history.replaceState(null, "", location.pathname + (m === "sl" ? "?mode=sl" : ""));
  };
  if (!model) {
    return (
      <main className="page-x mt-6 space-y-6">
        <PageHead title={t.weekly.title} />
        <Card className="p-5">
          <p id="weekly-none" className="text-sm text-fg-2">
            {t.weekly.none}
          </p>
        </Card>
      </main>
    );
  }
  const m = model.modes[mode] ?? null;
  const [year, week] = model.week.split("-w");
  const vs = model.baseline?.kind === "week" ? t.weekly.vsWeek(String(Number(model.baseline.week.split("-w")[1]))) : model.baseline?.kind === "previous_patch" ? t.weekly.vsPatch(model.patch, md(model.start)) : t.weekly.vsNone;

  return (
    <main className="page-x mt-6 space-y-6">
      <PageHead
        title={t.weekly.title}
        aside={
          <Segmented
            label={t.common.gameMode}
            idPrefix="mode"
            value={mode}
            onChange={change}
            options={[
              { value: "qm", label: t.common.modes.qm },
              { value: "sl", label: t.common.modes.sl },
            ]}
          />
        }
      >
        <p id="meta-line" className="num mt-0.5 text-xs text-muted">
          {t.weekly.weekLabel(year!, String(Number(week)), md(model.monday), md(model.sunday))} · {model.baseline?.kind === "previous_patch" ? vs : `${t.common.patch(model.patch)} · ${vs}`}
        </p>
        <nav aria-label={t.weekly.title} className="mt-2 flex gap-3 text-xs font-semibold">
          {model.older && (
            <a id="older-issue" href={href.meta(model.older)} className="text-muted hover:text-primary">
              {t.weekly.olderIssue}
            </a>
          )}
          {model.newer && (
            <a id="newer-issue" href={href.meta(model.newer)} className="text-muted hover:text-primary">
              {t.weekly.newerIssue}
            </a>
          )}
        </nav>
      </PageHead>

      {!m ? (
        <Card className="p-5">
          <p className="text-sm text-muted">{t.weekly.noMode}</p>
        </Card>
      ) : (
        <ModeReport m={m} mode={mode} />
      )}
      <p className="text-2xs leading-relaxed text-muted">{t.weekly.rule}</p>
      {/* does it match what players see? (owner 2026-10-05) — one thread per issue, both modes */}
      <CommentThread thread={`weekly:${model.week}`} sub={t.comments.subWeekly} />
    </main>
  );
}

function ModeReport({ m, mode }: { m: WeeklyModeModel; mode: Mode }) {
  const t = useT();
  const { headline: h } = m;
  const lines = [
    h.up && t.weekly.up(h.up.hero.ko, String(h.up.prevRank), String(h.up.rank)),
    h.down && t.weekly.down(h.down.hero.ko, String(h.down.prevRank), String(h.down.rank)),
    h.mostPlayed && t.weekly.mostPlayed(h.mostPlayed.hero.ko, int(h.mostPlayed.games), pct(h.mostPlayed.pick)),
  ].filter(Boolean) as string[];
  return (
    <>
      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-7" aria-labelledby="h-week-summary">
          <CardHeader id="h-week-summary" title={t.weekly.summaryTitle} />
          <ol id="weekly-summary" className="num space-y-1.5 px-4 py-3 text-[13px] text-fg-2">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ol>
        </Card>
        <Card className="lg:col-span-5 lg:self-start" aria-labelledby="h-fresh">
          <CardHeader id="h-fresh" title={t.weekly.freshTitle} sub={t.weekly.freshSub} />
          {m.fresh.length ? (
            <ul id="weekly-fresh" className="divide-y divide-line">
              {m.fresh.map((r) => (
                <li key={r.hero.slug} className="px-4 py-2">
                  <HeroLine r={r} mode={mode} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-4 text-[13px] text-muted">–</p>
          )}
        </Card>
      </div>

      <Card aria-labelledby="h-week-top">
        <CardHeader id="h-week-top" title={t.weekly.topTitle} sub={t.weekly.topSub(int(m.matches))} />
        <ol id="weekly-top" className="divide-y divide-line">
          {m.top.map((r) => (
            <li key={r.hero.slug} data-hero={r.hero.slug} className="grid grid-cols-[2rem_1fr_auto] items-center gap-2 px-4 py-1.5">
              <span className="num font-bold text-fg">{r.rank}</span>
              <HeroLine r={r} mode={mode} />
              <RankDelta value={r.delta} />
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Movers id="weekly-up" title={t.weekly.upTitle} rows={m.up} mode={mode} />
        <Movers id="weekly-down" title={t.weekly.downTitle} rows={m.down} mode={mode} />
      </div>

      {m.daily.days.length > 0 && m.daily.series.length > 0 && (
        <Card aria-labelledby="h-daily">
          <CardHeader id="h-daily" title={t.weekly.dailyTitle} sub={t.weekly.dailySub(String(DAILY_MIN_GAMES))} />
          <div id="weekly-daily" className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
            {m.daily.series.map((s) => (
              <div key={s.hero.slug} data-hero={s.hero.slug} className="rounded-lg border border-line bg-surface-2 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Portrait src={s.hero.portrait} size={24} role={s.hero.role} />
                  <span className="text-[13px] font-semibold text-fg">{s.hero.ko}</span>
                </div>
                <Spark days={m.daily.days} wr={s.wr} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

function HeroLine({ r, mode }: { r: WeeklyRow; mode: Mode }) {
  const href = hotsHref(useLocale());
  const t = useT();
  return (
    <a href={href.hero(r.hero.slug, mode)} className="flex min-w-0 items-center gap-2.5 hover:text-primary">
      <Portrait src={r.hero.portrait} size={28} role={r.hero.role} />
      <span className="truncate text-[13px] font-semibold text-fg">{r.hero.ko}</span>
      <TierBadge tier={r.tier} size="sm" />
      <span className="num ml-auto whitespace-nowrap text-xs">
        {r.prevWr !== null && <span className="text-muted">{pct(r.prevWr)} → </span>}
        <span className={cx("font-semibold", wrClass(r.wr))}>{pct(r.wr)}</span>
        <span className="hidden text-muted sm:inline"> · {t.common.games(int(r.games))}</span>
      </span>
    </a>
  );
}

function Movers({ id, title, rows, mode }: { id: string; title: string; rows: WeeklyRow[]; mode: Mode }) {
  const t = useT();
  return (
    <Card aria-labelledby={`h-${id}`}>
      <CardHeader id={`h-${id}`} title={title} />
      {rows.length ? (
        <ol id={id} className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.hero.slug} data-hero={r.hero.slug} className="grid grid-cols-[1fr_auto] items-center gap-2 px-4 py-1.5">
              <HeroLine r={r} mode={mode} />
              <span className="num inline-flex items-center gap-1.5 text-xs">
                <span className="text-muted">
                  #{r.prevRank} → #{r.rank}
                </span>
                <RankDelta value={r.delta} />
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-4 py-4 text-[13px] text-muted">{t.weekly.noMoves}</p>
      )}
    </Card>
  );
}

/** A small line of the day's win rates around 50 %; a thin day is a gap. Colours come from the theme. */
function Spark({ days, wr }: { days: string[]; wr: (number | null)[] }) {
  const W = 220;
  const H = 56;
  const pad = 6;
  const vals = wr.filter((v): v is number => v !== null);
  const lo = Math.min(40, ...vals);
  const hi = Math.max(60, ...vals);
  const x = (i: number) => (days.length === 1 ? W / 2 : pad + (i * (W - pad * 2)) / (days.length - 1));
  const y = (v: number) => H - pad - ((v - lo) / (hi - lo)) * (H - pad * 2);
  // break the line at gaps
  const segments: string[] = [];
  let cur = "";
  wr.forEach((v, i) => {
    if (v === null) {
      if (cur) segments.push(cur);
      cur = "";
    } else cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  if (cur) segments.push(cur);
  return (
    <div className="mt-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full" role="img" aria-label={wr.map((v, i) => `${md(days[i]!)} ${v === null ? "–" : pct(v)}`).join(", ")}>
        <line x1={pad} x2={W - pad} y1={y(50)} y2={y(50)} className="stroke-line" strokeDasharray="3 3" />
        {segments.map((d, i) => (
          <path key={i} d={d} fill="none" className="stroke-primary" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {wr.map((v, i) => (v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={2.5} className="fill-primary" />))}
      </svg>
      <div className="num flex justify-between text-2xs text-muted">
        {days.map((d, i) => (
          <span key={d}>
            {md(d)} {wr[i] === null ? "–" : pct(wr[i]!)}
          </span>
        ))}
      </div>
    </div>
  );
}
