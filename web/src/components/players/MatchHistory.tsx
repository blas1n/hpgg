"use client";

import { useEffect, useMemo, useState } from "react";
import { assetUrl, loadTalents, type HeroTable, type MapTable, type TalentTable } from "@/data";
import { useLocale, useT } from "@/i18n/client";
import { briefing, matchRows, type Briefing, type MatchesResponse, type MatchView } from "@/lib/matches";
import { Card, CardHeader, cx, Portrait } from "../ui";

const PAGE = 20;
const int = (n: number) => Math.round(n).toLocaleString("ko-KR");
const kda = (n: number | null) => (n === null ? "–" : n.toFixed(2));
const wrClass = (wr: number | null) => (wr === null ? "text-muted" : wr >= 50 ? "text-pos" : "text-neg");
const pct = (n: number | null) => (n === null ? "–" : `${n.toFixed(0)}%`);

/** 전적 검색 below the profile: the briefing over the newest games, the MMR line, and every loaded game. */
export function MatchHistory({ data, heroes, maps }: { data: MatchesResponse; heroes: HeroTable; maps: MapTable }) {
  const locale = useLocale();
  const t = useT().players.games;
  const [shown, setShown] = useState(PAGE);
  const [talents, setTalents] = useState<Record<string, TalentTable | null>>({});
  const b = useMemo(() => briefing(data.matches, heroes, locale), [data, heroes, locale]);
  const rows = useMemo(() => matchRows(data.matches, heroes, maps, talents, locale), [data, heroes, maps, talents, locale]);

  // talent names and icons, one file per hero on screen, fetched once
  const visible = rows.slice(0, shown);
  const wanted = [...new Set(visible.filter((m) => m.talents.length && m.slug).map((m) => m.slug!))].filter((s) => !(s in talents)).join(",");
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    void Promise.all(wanted.split(",").map(async (slug) => [slug, await loadTalents(slug).catch(() => null)] as const)).then((got) => {
      if (live) setTalents((prev) => ({ ...prev, ...Object.fromEntries(got) }));
    });
    return () => {
      live = false;
    };
  }, [wanted]);

  return (
    <div id="player-games" data-source={data.source} className="space-y-4">
      {data.source === "basic" && (
        <p id="games-basic" className="rounded-lg border border-warn-line bg-warn-bg px-4 py-2.5 text-xs text-warn-fg">
          {t.basic}
        </p>
      )}
      <BriefingCard b={b} />
      <Card aria-labelledby="h-games">
        <CardHeader id="h-games" title={t.listTitle} sub={t.listSub(String(rows.length))} />
        <ul id="player-matches" className="divide-y divide-line">
          {visible.map((m) => (
            <MatchItem key={m.key} m={m} />
          ))}
        </ul>
        {rows.length > shown && (
          <button
            type="button"
            id="games-more"
            onClick={() => setShown((n) => n + PAGE)}
            className="w-full border-t border-line py-2.5 text-xs font-semibold text-fg-2 hover:bg-surface-2 hover:text-fg"
          >
            {t.more(String(Math.min(PAGE, rows.length - shown)))}
          </button>
        )}
      </Card>
    </div>
  );
}

function BriefingCard({ b }: { b: Briefing }) {
  const t = useT().players;
  const g = t.games;
  return (
    <Card aria-labelledby="h-brief" id="player-brief" className="overflow-hidden">
      <CardHeader id="h-brief" title={g.briefTitle(String(b.games))} />
      <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Ring value={b.winRate} />
            <div className="num">
              <div id="brief-record" className="text-sm font-bold text-fg">
                {t.record(String(b.wins), String(b.losses))}
              </div>
              {b.kda !== null && b.avg && (
                <>
                  <div id="brief-kda" className="mt-1 text-lg font-extrabold text-fg">
                    {kda(b.kda)} <span className="text-xs font-semibold text-muted">{g.kda}</span>
                  </div>
                  <div className="text-xs text-fg-2">
                    {b.avg.kills.toFixed(1)} / <span className="text-neg">{b.avg.deaths.toFixed(1)}</span> / {b.avg.assists.toFixed(1)}
                  </div>
                </>
              )}
            </div>
          </div>
          {b.avg && (
            <div>
              <h3 className="text-2xs font-semibold text-muted">{g.perGame}</h3>
              <dl id="brief-avg" className="num mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <Avg label={g.stat.heroDamage} value={int(b.avg.heroDamage)} />
                <Avg label={g.stat.siegeDamage} value={int(b.avg.siegeDamage)} />
                <Avg label={g.stat.damageTaken} value={int(b.avg.damageTaken)} />
                <Avg label={g.stat.experience} value={int(b.avg.experience)} />
                {b.avg.healing !== null && <Avg label={g.stat.healing} value={int(b.avg.healing)} />}
              </dl>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="text-2xs font-semibold text-muted">{g.mostHeroes}</h3>
              <ul id="brief-heroes" className="mt-1.5 space-y-1.5">
                {b.heroes.map((h) => (
                  <li key={h.name} data-hero={h.slug ?? undefined} className="flex items-center gap-2">
                    <Portrait src={h.portrait} size={28} role={h.role} />
                    <span className="num min-w-0 text-2xs leading-tight">
                      <span className="block truncate text-xs font-semibold text-fg">{h.name}</span>
                      <span className={wrClass((h.wins / Math.max(1, h.wins + h.losses)) * 100)}>
                        {pct((h.wins / Math.max(1, h.wins + h.losses)) * 100)}
                      </span>{" "}
                      <span className="text-muted">
                        {t.record(String(h.wins), String(h.losses))}
                        {h.kda !== null && ` · ${kda(h.kda)}`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-2xs font-semibold text-muted">{g.roles}</h3>
              <ul id="brief-roles" className="mt-1.5 space-y-1.5">
                {b.roles.map((r) => (
                  <li key={r.role} data-role={r.role} className="text-2xs">
                    <div className="flex justify-between gap-2">
                      <span className="truncate text-fg-2">{r.label}</span>
                      <span className="num text-muted">{r.games}</span>
                    </div>
                    <span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-surface-3">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{
                          width: `${(r.games / Math.max(1, b.games)) * 100}%`,
                        }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <MmrChart b={b} />
      </div>
    </Card>
  );
}

function Avg({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-line/60 py-0.5">
      <dt className="truncate text-fg-2">{label}</dt>
      <dd className="font-semibold text-fg">{value}</dd>
    </div>
  );
}

/** Win rate as a ring: one value, so a ring and the number, not a chart. */
function Ring({ value }: { value: number | null }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const v = value ?? 0;
  return (
    <span className="relative inline-flex size-16 shrink-0 items-center justify-center" aria-hidden>
      <svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-surface-3" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${(v / 100) * c} ${c}`}
          className={v >= 50 ? "stroke-pos" : "stroke-neg"}
        />
      </svg>
      <span className={cx("num text-sm font-extrabold", wrClass(value))}>{pct(value)}</span>
    </span>
  );
}

/** MMR after each game of one mode: one series, a 2 px line in the primary colour, a hover readout per game. */
function MmrChart({ b }: { b: Briefing }) {
  const g = useT().players.games;
  const [hover, setHover] = useState<number | null>(null);
  const pts = b.mmr.points;
  if (pts.length < 2) return null;
  const W = 400; // about the width it is drawn at, so labels and points keep their size on a phone
  const H = 170;
  const pad = { l: 38, r: 8, t: 10, b: 14 };
  const lo = Math.min(...pts.map((p) => p.mmr));
  const hi = Math.max(...pts.map((p) => p.mmr));
  const span = Math.max(1, hi - lo);
  const x = (i: number) => pad.l + (i / (pts.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b);
  const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.mmr).toFixed(1)}`).join(" ");
  const step = (W - pad.l - pad.r) / (pts.length - 1);
  const h = hover === null ? null : pts[hover]!;
  return (
    <figure id="brief-mmr" aria-labelledby="h-mmr" className="min-w-0">
      <figcaption>
        <h3 id="h-mmr" className="text-sm font-bold text-fg">
          {g.mmrTitle(b.mmr.label)}
        </h3>
        <p className="text-2xs text-muted">{g.mmrSub(String(pts.length))}</p>
      </figcaption>
      <div className="relative mt-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full"
          role="img"
          aria-label={`${g.mmrTitle(b.mmr.label)}: ${pts[0]!.mmr} → ${pts.at(-1)!.mmr}`}
          onMouseLeave={() => setHover(null)}
        >
          {[hi, (hi + lo) / 2, lo].map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="stroke-line" strokeDasharray="3 4" />
              <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" className="num fill-muted text-[11px]">
                {Math.round(v)}
              </text>
            </g>
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="stroke-line-strong" />}
          <polyline points={line} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className="stroke-primary" />
          {pts.map((p, i) => (
            <circle key={i} cx={x(i)} cy={y(p.mmr)} r={hover === i ? 5 : 3} strokeWidth="2" className={cx("stroke-surface", p.win ? "fill-pos" : "fill-neg")} />
          ))}
          {pts.map((p, i) => (
            <rect
              key={`h${i}`}
              x={x(i) - step / 2}
              y={0}
              width={step}
              height={H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onTouchStart={() => setHover(i)}
            />
          ))}
        </svg>
        {h && hover !== null && (
          <div
            role="status"
            className="num pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-line-strong bg-pop px-2 py-1 text-2xs whitespace-nowrap text-pop-fg shadow"
            style={{ left: `${(x(hover) / W) * 100}%` }}
          >
            {g.mmrPoint(h.hero, String(h.mmr))} · {h.date.slice(5, 16)}
          </div>
        )}
      </div>
    </figure>
  );
}

function MatchItem({ m }: { m: MatchView }) {
  const t = useT().players;
  const g = t.games;
  const tone = m.win === null ? "border-l-line" : m.win ? "border-l-pos" : "border-l-neg";
  return (
    <li
      data-result={m.win ? "win" : "loss"}
      className={cx(
        "grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 border-l-4 px-3 py-3 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto]",
        tone,
        m.win ? "bg-pos/5" : "bg-neg/5",
      )}
    >
      <div className="num text-2xs leading-snug">
        <div className={cx("text-xs font-bold", m.win ? "text-pos" : "text-neg")}>{m.win ? t.win : t.loss}</div>
        <div className="text-fg-2">{m.mode}</div>
        <div className="text-muted">{m.when}</div>
        {m.mmrChange !== null && (
          <div data-mmr className={cx("mt-1 inline-block rounded px-1 font-semibold", m.mmrChange >= 0 ? "bg-pos/15 text-pos" : "bg-neg/15 text-neg")}>
            {m.mmrChange > 0 ? "+" : ""}
            {(Math.round(m.mmrChange * 10) / 10).toFixed(1)}
          </div>
        )}
      </div>

      <div className="flex min-w-0 items-center gap-3">
        <span className="relative">
          <Portrait src={m.portrait} size={44} role={m.role} />
          {m.level !== null && (
            <span
              title={g.level(String(m.level))}
              className="num absolute -right-1.5 -bottom-1.5 rounded-full border border-line bg-surface px-1 text-[10px] font-bold text-fg"
            >
              {m.level}
            </span>
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-fg">{m.hero}</span>
          <span className="block truncate text-2xs text-muted">{m.map}</span>
        </span>
        {m.kda && (
          <span data-kda className="num ml-auto shrink-0 text-right sm:ml-4">
            <span className="block text-sm font-bold text-fg">
              {m.kda.kills} / <span className="text-neg">{m.kda.deaths}</span> / {m.kda.assists}
            </span>
            <span className="block text-2xs text-muted">{m.kda.perfect ? g.perfect : `${kda(m.kda.ratio)} ${g.kda}`}</span>
          </span>
        )}
      </div>

      {m.stats && (
        <dl data-stats className="num col-span-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-2xs sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:w-56">
          <Avg label={g.stat.heroDamage} value={m.stats.heroDamage === null ? "–" : int(m.stats.heroDamage)} />
          <Avg label={g.stat.siegeDamage} value={m.stats.siegeDamage === null ? "–" : int(m.stats.siegeDamage)} />
          {m.stats.healing ? (
            <Avg label={g.stat.healing} value={int(m.stats.healing)} />
          ) : (
            <Avg label={g.stat.damageTaken} value={m.stats.damageTaken === null ? "–" : int(m.stats.damageTaken)} />
          )}
          <Avg label={g.stat.experience} value={m.stats.experience === null ? "–" : int(m.stats.experience)} />
        </dl>
      )}

      {m.talents.length > 0 && (
        <ol data-talents aria-label={g.talentsAria(m.hero)} className="col-span-2 flex gap-1 sm:col-start-2 sm:col-span-2">
          {m.talents.map((tl) => (
            <li key={tl.level} title={tl.name ? `${tl.level} · ${tl.name}` : String(tl.level)}>
              {tl.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={assetUrl(`img/talents/${tl.icon}`)}
                  alt={tl.name ?? ""}
                  width={26}
                  height={26}
                  loading="lazy"
                  className="size-[26px] rounded border border-line bg-surface-3"
                />
              ) : (
                <span className="num flex size-[26px] items-center justify-center rounded border border-line bg-surface-3 text-[10px] text-muted">
                  {tl.level}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}
