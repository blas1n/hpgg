"use client";

import { assetUrl, hotsHref, type Mode } from "@/data";
import { useLocale, useT } from "@/i18n/client";
import type { CentreCard, CentreGap, WeeklyModeModel, WeeklyModel, WeeklyRow } from "@/lib/weekly";
import { DAILY_MIN_GAMES } from "@/lib/weekly";
import { PageHead } from "@/components/PageHead";
import { CommentThread } from "@/components/comments/CommentThread";
import { Card, CardHeader, cx, Portrait, RankDelta, TierBadge } from "../ui";

const pct = (n: number) => `${n.toFixed(1)}%`;
const int = (n: number) => n.toLocaleString("ko-KR");
const wrClass = (wr: number) => (wr >= 50 ? "text-pos" : "text-neg");
const md = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;

/** 주간 메타 리포트: one issue, Storm League only (owner 2026-10-05: Quick Match picks come before the map and the
 *  teams, so there is no counter pick to explain). The week's prose first, its evidence, then the numbers. */
export function WeeklyView({ model, centre }: { model: WeeklyModel | null; centre: CentreCard | null }) {
  const t = useT();
  const href = hotsHref(useLocale());
  const mode: Mode = "sl";
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
  const vs =
    model.baseline?.kind === "week"
      ? t.weekly.vsWeek(String(Number(model.baseline.week.split("-w")[1])))
      : model.baseline?.kind === "previous_patch"
        ? t.weekly.vsPatch(model.patch, md(model.start))
        : model.baseline?.kind === "before_hotfix"
          ? t.weekly.vsHotfix
          : t.weekly.vsNone;

  return (
    <main className="page-x mt-6 space-y-6">
      <PageHead title={t.weekly.title}>
        <p id="meta-line" className="num mt-0.5 text-xs text-muted">
          {t.weekly.weekLabel(year!, String(Number(week)), md(model.monday), md(model.sunday))} · {t.weekly.basisSl} · {model.baseline?.kind === "previous_patch" ? vs : `${t.common.patch(model.patch)} · ${vs}`}
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

      {model.analysis && model.analysis.cards.length > 0 && <Cards cards={model.analysis.cards} />}
      {model.analysis && <Analysis a={model.analysis} />}
      {centre && <Evidence c={centre} />}
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

/** 카드뉴스 (owner 2026-10-07): the week in 6–7 cards, swiped through above the prose that backs them. */
function Cards({ cards }: { cards: { src: string; alt: string }[] }) {
  const t = useT();
  return (
    <section aria-label={t.weekly.cardsLabel}>
      <ol id="weekly-cards" className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
        {cards.map((c) => (
          <li key={c.src} className="w-[min(78vw,300px)] shrink-0 snap-start">
            <img src={assetUrl(c.src)} alt={c.alt} width={1080} height={1350} loading="lazy" className="aspect-[4/5] h-auto w-full rounded-lg border border-line" />
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The week's prose, drafted from the evidence and published after the owner's review. */
function Analysis({ a }: { a: NonNullable<WeeklyModel["analysis"]> }) {
  const t = useT();
  return (
    <Card aria-labelledby="h-analysis">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <h2 id="h-analysis" className="text-[17px] font-bold text-fg">
          {a.title}
        </h2>
        {a.status === "draft" && (
          <span data-status="draft" className="rounded border border-warn-line bg-warn-bg px-1.5 py-px text-2xs font-bold text-warn-fg">
            {t.weekly.draftBadge}
          </span>
        )}
      </header>
      <div id="weekly-analysis" className="space-y-3 px-4 py-4 text-[15px] leading-7 text-fg-2">
        {a.paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <p className="border-t border-line px-4 py-2.5 text-2xs leading-relaxed text-muted">{a.notes}</p>
    </Card>
  );
}

/** What the prose stands on: the centre's use, where its specs and averages rank, its matchups. */
function Evidence({ c }: { c: CentreCard }) {
  const t = useT();
  const w = t.weekly;
  return (
    <Card aria-labelledby="h-evidence">
      <CardHeader id="h-evidence" title={w.evidenceTitle} sub={w.evidenceSub(c.hero.ko)} />
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <div className="flex items-center gap-3">
            <Portrait src={c.hero.portrait} size={48} role={c.hero.role} />
            <div>
              <div className="text-[15px] font-bold text-fg">{c.hero.ko}</div>
              <div className="num text-xs text-fg-2">{w.centreUse(pct(c.banRate), pct(c.pick), pct(c.wr), int(c.games))}</div>
            </div>
          </div>
          <dl id="evidence-stats" className="num mt-3 divide-y divide-line/70 text-[13px]">
            {c.life && <StatRow label={w.lifeLabel} value={int(c.life.value)} ranks={[w.rankRole(String(c.life.rankRole), String(c.life.ofRole))]} />}
            {c.stats.map((s) => (
              <StatRow
                key={s.key}
                label={w.statLabels[s.key] ?? s.key}
                value={s.key === "deaths" ? s.value.toFixed(1) : int(Math.round(s.value))}
                ranks={[s.rankAll !== null ? w.rankAll(String(s.rankAll), String(s.ofAll)) : "", s.rankRole !== null ? w.rankRole(String(s.rankRole), String(s.ofRole)) : ""].filter(Boolean)}
              />
            ))}
          </dl>
        </div>
        <div className="space-y-3">
          <Gaps id="evidence-held" title={w.heldByTitle(c.hero.ko)} rows={c.heldBy} />
          <Gaps id="evidence-crushes" title={w.crushesTitle(c.hero.ko)} rows={c.crushes} />
          <p className="text-2xs text-muted">{w.gapRule}</p>
        </div>
      </div>
    </Card>
  );
}

function StatRow({ label, value, ranks }: { label: string; value: string; ranks: string[] }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 py-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold text-fg">{value}</dd>
      <dd className="ml-auto text-2xs text-fg-2">{ranks.join(" · ")}</dd>
    </div>
  );
}

function Gaps({ id, title, rows }: { id: string; title: string; rows: CentreGap[] }) {
  const t = useT();
  const w = t.weekly;
  return (
    <div>
      <h3 className="text-xs font-bold text-fg">{title}</h3>
      <ul id={id} className="mt-1 divide-y divide-line/70">
        {rows.slice(0, 6).map((g) => (
          <li key={g.hero.slug} data-significant={g.significant} className="flex items-center gap-2 py-1 text-[13px]">
            <Portrait src={g.hero.portrait} size={22} role={g.hero.role} />
            <span className="min-w-0 truncate text-fg">{g.hero.ko}</span>
            <span className="num ml-auto whitespace-nowrap text-2xs text-fg-2">{w.gapLine(pct(g.centreWr), int(g.games), `${g.delta > 0 ? "+" : ""}${g.delta.toFixed(1)}%p`)}</span>
            <span className={cx("shrink-0 rounded border px-1 py-px text-2xs font-bold", g.significant ? "border-primary/50 text-primary" : "border-line text-muted")}>{g.significant ? w.finding : w.hunch}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
