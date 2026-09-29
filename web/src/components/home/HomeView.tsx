"use client";

import { useEffect, useState } from "react";
import { fallbackNote, hotsHref, MODE_LABEL, shortDate, type Mode } from "@/data";
import type { HomeModel, MapCard, Mover, TopRow } from "@/lib/home";
import { MapCardLink } from "../MapCardLink";
import { PlayerSearchForm } from "../players/PlayerSearchForm";
import { Card, CardHeader, cx, MoreLink, Portrait, RankDelta, Segmented } from "../ui";

const pct = (n: number) => `${n.toFixed(1)}%`;
const int = (n: number) => n.toLocaleString("ko-KR");
const wrClass = (wr: number) => (wr >= 50 ? "text-pos" : "text-neg");

export function HomeView({ models, maps }: { models: Record<Mode, HomeModel>; maps: MapCard[] }) {
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
        <PlayerSearchForm id="home-player-search" className="mx-auto max-w-xl" />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-fg">오늘의 메타</h1>
            <p id="meta-line" className="num mt-0.5 text-xs text-muted">
              {MODE_LABEL[mode]} · 패치 {m.patch} · {int(m.matches)} 매치 · {shortDate(m.collectedAt)} 갱신
              {m.fallbackFrom && <span data-fallback> · {fallbackNote(m.fallbackFrom)}</span>}
            </p>
          </div>
          <Segmented
            label="게임 모드"
            idPrefix="mode"
            value={mode}
            onChange={change}
            options={[
              { value: "qm", label: MODE_LABEL.qm },
              { value: "sl", label: MODE_LABEL.sl },
            ]}
          />
        </div>

        <Card aria-labelledby="h-leaders">
          <CardHeader id="h-leaders" title="역할별 1위" sub="역할마다 티어 점수가 가장 높은 영웅" action={<MoreLink href={hotsHref.tier(mode === "sl" ? "mode=sl" : "")}>전체 티어표</MoreLink>} />
          <div id="role-top" className="grid grid-cols-2 gap-2 p-3 lg:grid-cols-3 xl:grid-cols-6">
            {m.leaders.map((l) => (
              <a
                key={l.role}
                href={hotsHref.hero(l.hero.slug, mode)}
                data-role={l.role}
                data-card="role" className="group flex flex-col items-start gap-2 rounded-lg border border-transparent bg-surface-2 p-3 transition-colors hover:border-line-strong hover:bg-surface-3 sm:flex-row sm:items-center sm:gap-3 xl:flex-col xl:items-start"
              >
                <Portrait src={l.hero.portrait} size={52} tier={l.tier} role={l.hero.role} />
                <span className="w-full min-w-0">
                  <span className="block text-2xs font-semibold text-muted">{l.role_ko}</span>
                  <span className="block truncate text-[15px] font-bold text-fg group-hover:text-primary">{l.hero.ko}</span>
                  <span className="num mt-0.5 block text-xs text-fg-2">
                    <span className={wrClass(l.win_rate)}>{pct(l.win_rate)}</span> 승률 · {pct(l.pick)} 픽
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
          <CardHeader id="h-maps" title="전장" sub="폭풍 리그 매치가 많은 전장 · 누르면 그 전장의 티어표" action={<MoreLink href={hotsHref.maps}>전체 전장</MoreLink>} />
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
  const sl = mode === "sl";
  return (
    <Card className="lg:col-span-7" aria-labelledby="h-top">
      <CardHeader id="h-top" title="티어 TOP 10" sub={`${MODE_LABEL[mode]} · 티어 점수 순`} action={<MoreLink href={hotsHref.tier(sl ? "mode=sl" : "")}>전체 보기</MoreLink>} />
      <table id="top10" className="w-full text-[13px]">
        <thead>
          <tr className="text-2xs text-muted">
            <th className="w-14 py-2 pl-4 text-left font-semibold">순위</th>
            <th className="py-2 text-left font-semibold">영웅</th>
            <th className="py-2 pr-3 text-right font-semibold">승률</th>
            <th className="py-2 pr-3 text-right font-semibold">픽률</th>
            {sl && <th className="hidden py-2 pr-4 text-right font-semibold sm:table-cell">밴률</th>}
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
                <a href={hotsHref.hero(r.hero.slug, mode)} className="group flex items-center gap-2.5">
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
  const [dir, setDir] = useState<"up" | "down">("up");
  const list: Mover[] = model.movers ? model.movers[dir] : [];
  const sub = model.movers
    ? model.movers.up.length + model.movers.down.length
      ? `직전 패치 ${model.previousPatch} 대비 순위 변동`
      : "직전 패치와 순위 변동 없음"
    : "직전 패치 데이터가 쌓이면 표시됩니다";
  return (
    <Card className="lg:col-span-5 lg:self-start" aria-labelledby="h-movers">
      <CardHeader
        id="h-movers"
        title="메타 변동"
        sub={<span id="movers-sub">{sub}</span>}
        action={
          model.movers && (
            <Segmented
              label="변동 방향"
              value={dir}
              onChange={setDir}
              options={[
                { value: "up", label: "상승" },
                { value: "down", label: "하락" },
              ]}
            />
          )
        }
      />
      <ol id="movers" className="divide-y divide-line/70">
        {list.map((d) => (
          <li key={d.hero.slug}>
            <a href={hotsHref.hero(d.hero.slug, mode)} data-hero={d.hero.slug} data-card="mover" className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
              <Portrait src={d.hero.portrait} size={36} tier={d.tier} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-fg group-hover:text-primary">{d.hero.ko}</span>
                <span className="num block text-2xs text-muted">
                  #{d.prevRank} → #{d.rank} · 승률 {pct(d.prevWinRate)} → {pct(d.win_rate)}
                </span>
              </span>
              <span className={cx("num rounded-md px-2 py-1 text-sm font-extrabold", d.delta > 0 ? "bg-pos/10 text-pos" : "bg-neg/10 text-neg")}>
                {d.delta > 0 ? "▲" : "▼"}
                {Math.abs(d.delta)}
              </span>
            </a>
          </li>
        ))}
        {model.movers && list.length === 0 && <li className="px-4 py-8 text-center text-[13px] text-muted">{dir === "up" ? "오른 영웅이 없습니다" : "내려간 영웅이 없습니다"}</li>}
        {!model.movers && <li className="px-4 py-8 text-center text-[13px] text-muted">첫 패치 변경 이후부터 보여 드립니다</li>}
      </ol>
    </Card>
  );
}
