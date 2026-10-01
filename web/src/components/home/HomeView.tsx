"use client";

import { useEffect, useState } from "react";
import { hotsHref, shortDate, type Mode } from "@/data";
import { useLocale, useT } from "@/i18n/client";
import type { HomeModel, MapCard, Mover, TopRow } from "@/lib/home";
import { MapCardLink } from "../MapCardLink";
import { PageHead } from "@/components/PageHead";
import { PlayerSearchForm } from "../players/PlayerSearchForm";
import { Card, CardHeader, cx, MoreLink, Portrait, RankDelta, Segmented } from "../ui";

const pct = (n: number) => `${n.toFixed(1)}%`;
const int = (n: number) => n.toLocaleString("ko-KR");
const wrClass = (wr: number) => (wr >= 50 ? "text-pos" : "text-neg");

export function HomeView({ models, maps }: { models: Record<Mode, HomeModel>; maps: MapCard[] }) {
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
  const m = models[mode];

  return (
    <>
      <main className="page-x mt-6 space-y-6">
        <div className="space-y-2">
          {/* what the site is, for a first visit (#30) */}
          <p id="site-tagline" className="text-center text-[13px] font-semibold text-fg-2">
            {t.home.tagline}
          </p>
          <PlayerSearchForm id="home-player-search" className="mx-auto max-w-xl" />
        </div>
        <PageHead
          title={t.home.title}
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
            {t.common.modes[mode]} · {t.common.patch(m.patch)} · {t.common.matches(int(m.matches))} · {t.common.updated(shortDate(m.collectedAt))}
            {m.fallbackFrom && <span data-fallback> · {t.common.fallbackNote(m.fallbackFrom)}</span>}
          </p>
        </PageHead>

        <Card aria-labelledby="h-leaders">
          <CardHeader id="h-leaders" title={t.home.leaders} sub={t.home.leadersSub} action={<MoreLink href={href.tier(mode === "sl" ? "mode=sl" : "")}>{t.home.fullTier}</MoreLink>} />
          <div id="role-top" className="grid grid-cols-2 gap-2 p-3 lg:grid-cols-3 xl:grid-cols-6">
            {m.leaders.map((l) => (
              <a
                key={l.role}
                href={href.hero(l.hero.slug, mode)}
                data-role={l.role}
                data-card="role" className="group flex flex-col items-start gap-2 rounded-lg border border-transparent bg-surface-2 p-3 transition-colors hover:border-line-strong hover:bg-surface-3 sm:flex-row sm:items-center sm:gap-3 xl:flex-col xl:items-start"
              >
                <Portrait src={l.hero.portrait} size={52} tier={l.tier} role={l.hero.role} />
                <span className="w-full min-w-0">
                  <span className="block text-2xs font-semibold text-muted">{l.role_ko}</span>
                  <span className="block truncate text-[15px] font-bold text-fg group-hover:text-primary">{l.hero.ko}</span>
                  <span className="num mt-0.5 block text-xs text-fg-2">
                    <span className={wrClass(l.win_rate)}>{pct(l.win_rate)}</span> {t.home.winRateShort} · {pct(l.pick)} {t.home.pickShort}
                  </span>
                </span>
              </a>
            ))}
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-12">
          <TopTable model={m} mode={mode} />
          <Movers model={m} mode={mode} />
        </div>

        <Card aria-labelledby="h-maps">
          <CardHeader id="h-maps" title={t.home.maps} sub={t.home.mapsSub} action={<MoreLink href={href.maps}>{t.home.allMaps}</MoreLink>} />
          <div id="map-grid" className="grid grid-cols-2 gap-2 p-3 sm:gap-3 lg:grid-cols-3">
            {maps.map((c) => (
              <MapCardLink key={c.slug} c={c} />
            ))}
          </div>
        </Card>
      </main>
    </>
  );
}

function TopTable({ model, mode }: { model: HomeModel; mode: Mode }) {
  const t = useT();
  const href = hotsHref(useLocale());
  const sl = mode === "sl";
  return (
    <Card className="lg:col-span-7" aria-labelledby="h-top">
      <CardHeader id="h-top" title={t.home.top10} sub={t.home.top10Sub(t.common.modes[mode])} action={<MoreLink href={href.tier(sl ? "mode=sl" : "")}>{t.home.seeAll}</MoreLink>} />
      <table id="top10" className="w-full text-[13px]">
        <thead>
          <tr className="text-2xs text-muted">
            <th className="w-14 py-2 pl-4 text-left font-semibold">{t.common.rank}</th>
            <th className="py-2 text-left font-semibold">{t.common.hero}</th>
            <th className="py-2 pr-3 text-right font-semibold">{t.common.winRate}</th>
            <th className="py-2 pr-3 text-right font-semibold">{t.common.pickRate}</th>
            {sl && <th className="hidden py-2 pr-4 text-right font-semibold sm:table-cell">{t.common.banRate}</th>}
          </tr>
        </thead>
        <tbody>
          {model.top.map((r: TopRow) => (
            <tr key={r.hero.slug} data-hero={r.hero.slug} className="border-t border-line/70 transition-colors hover:bg-surface-2">
              <td className="py-2 pl-4">
                <span className="num block font-bold text-fg">{r.rank}</span>
                <RankDelta value={r.delta} />
              </td>
              <td className="py-2">
                <a href={href.hero(r.hero.slug, mode)} className="group flex items-center gap-2.5">
                  <Portrait src={r.hero.portrait} size={34} tier={r.tier} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-fg group-hover:text-primary">{r.hero.ko}</span>
                    <span className="block truncate text-2xs text-muted">{r.hero.role_ko}</span>
                  </span>
                </a>
              </td>
              <td className={cx("num py-2 pr-3 text-right font-semibold", wrClass(r.win_rate))}>{pct(r.win_rate)}</td>
              <td className="num py-2 pr-3 text-right text-fg-2">{pct(r.pick)}</td>
              {sl && <td className="num hidden py-2 pr-4 text-right text-fg-2 sm:table-cell">{pct(r.ban_rate)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Movers({ model, mode }: { model: HomeModel; mode: Mode }) {
  const t = useT();
  const href = hotsHref(useLocale());
  const [dir, setDir] = useState<"up" | "down">("up");
  const list: Mover[] = model.movers ? model.movers[dir] : [];
  const sub = model.movers
    ? model.movers.up.length + model.movers.down.length
      ? t.home.moversVs(model.previousPatch ?? "")
      : t.home.moversNone
    : t.home.moversLater;
  return (
    <Card className="lg:col-span-5 lg:self-start" aria-labelledby="h-movers">
      <CardHeader
        id="h-movers"
        title={t.home.movers}
        sub={<span id="movers-sub">{sub}</span>}
        action={
          model.movers && (
            <Segmented
              label={t.home.moversDir}
              value={dir}
              onChange={setDir}
              options={[
                { value: "up", label: t.common.up },
                { value: "down", label: t.common.down },
              ]}
            />
          )
        }
      />
      <ol id="movers" className="divide-y divide-line/70">
        {list.map((d) => (
          <li key={d.hero.slug}>
            <a href={href.hero(d.hero.slug, mode)} data-hero={d.hero.slug} data-card="mover" className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
              <Portrait src={d.hero.portrait} size={36} tier={d.tier} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-fg group-hover:text-primary">{d.hero.ko}</span>
                <span className="num block text-2xs text-muted">
                  {t.home.moverLine(String(d.prevRank), String(d.rank), pct(d.prevWinRate), pct(d.win_rate))}
                </span>
              </span>
              <span className={cx("num rounded-md px-2 py-1 text-sm font-extrabold", d.delta > 0 ? "bg-pos/10 text-pos" : "bg-neg/10 text-neg")}>
                {d.delta > 0 ? "▲" : "▼"}
                {Math.abs(d.delta)}
              </span>
            </a>
          </li>
        ))}
        {model.movers && list.length === 0 && <li className="px-4 py-8 text-center text-[13px] text-muted">{dir === "up" ? t.home.noRisers : t.home.noFallers}</li>}
        {!model.movers && <li className="px-4 py-8 text-center text-[13px] text-muted">{t.home.firstPatch}</li>}
      </ol>
    </Card>
  );
}
