"use client";

import { useCallback, useEffect, useState } from "react";
import type { HeroTable, MapTable } from "@/data";
import { fetchPlayer, isRegion, parseBattletag, playersHref, playerView, type PlayerResult, type PlayerView, type Region } from "@/lib/players";
import { Card, CardHeader, cx, Portrait } from "../ui";
import { PlayerSearchForm } from "./PlayerSearchForm";

type State = { kind: "idle" } | { kind: "loading"; tag: string } | PlayerResult;

const pct = (n: number | null) => (n === null ? "–" : `${n.toFixed(1)}%`);
const int = (n: number) => n.toLocaleString("ko-KR");
const wrClass = (wr: number | null) => (wr === null ? "text-muted" : wr >= 50 ? "text-pos" : "text-neg");
const LEAGUE_CLASS: Record<string, string> = {
  grandmaster: "text-secondary",
  master: "text-secondary",
  diamond: "text-primary",
  platinum: "text-accent",
  gold: "text-warn-fg",
  silver: "text-fg-2",
  bronze: "text-fg-2",
};

/** 전적 검색: the query lives in the URL (?tag=Name%231234&region=KR), so a search is shareable and 홈 can link here. */
export function PlayerSearchView({ heroes, maps }: { heroes: HeroTable; maps: MapTable }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [query, setQuery] = useState<{ tag: string; region: Region } | null>(null);
  const [formKey, setFormKey] = useState(0);

  const run = useCallback(async (tag: string, region: Region) => {
    setQuery({ tag, region });
    setState({ kind: "loading", tag });
    setState(await fetchPlayer(tag, region));
  }, []);

  useEffect(() => {
    const fromUrl = () => {
      const params = new URLSearchParams(location.search);
      const tag = parseBattletag(params.get("tag") ?? "");
      const region = params.get("region");
      if (!tag) {
        setQuery(null);
        setState(params.get("tag") ? { kind: "invalid" } : { kind: "idle" });
        return;
      }
      setFormKey((k) => k + 1); // re-seed the form with the URL's query
      void run(tag, isRegion(region) ? region : "KR");
    };
    fromUrl();
    window.addEventListener("popstate", fromUrl);
    return () => window.removeEventListener("popstate", fromUrl);
  }, [run]);

  const search = (tag: string, region: Region) => {
    history.pushState(null, "", playersHref(tag, region));
    void run(tag, region);
  };

  return (
    <main className="page-x mt-6 space-y-4 pb-10">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-fg">전적 검색</h1>
        <p className="mt-0.5 text-xs text-muted">배틀태그와 지역으로 찾기 · Heroes Profile에 리플레이가 올라온 경기 기준</p>
      </div>
      <PlayerSearchForm key={formKey} initialTag={query?.tag ?? ""} initialRegion={query?.region ?? "KR"} onSearch={search} className="max-w-xl" />
      <section id="player-result" data-state={state.kind} aria-live="polite" aria-busy={state.kind === "loading"}>
        <Result state={state} heroes={heroes} maps={maps} retry={query ? () => void run(query.tag, query.region) : undefined} />
      </section>
    </main>
  );
}

function Result({ state, heroes, maps, retry }: { state: State; heroes: HeroTable; maps: MapTable; retry?: () => void }) {
  switch (state.kind) {
    case "idle":
      return <Notice title="배틀태그로 전적을 찾아보세요" body="이름#1234 형식으로 입력하고 지역을 고르세요. 한국 서버는 아시아입니다." />;
    case "loading":
      return (
        <Card className="animate-pulse p-6">
          <p className="text-sm text-muted">{state.tag} 전적을 불러오는 중…</p>
        </Card>
      );
    case "offline":
      return <Notice tone="info" title="전적 검색 준비 중" body="전적 서버를 준비하고 있습니다. 곧 열립니다 — 티어표와 영웅 통계는 지금 그대로 쓸 수 있어요." />;
    case "error":
      return <Notice tone="warn" title="전적 서버가 응답하지 않습니다" body="Heroes Profile 응답이 없어 지금은 새로 조회할 수 없습니다. 잠시 후 다시 시도하세요." retry={retry} />;
    case "not_found":
      return <Notice title="플레이어를 찾지 못했습니다" body="배틀태그 철자·번호와 지역을 확인하세요. Heroes Profile에 리플레이가 한 번도 올라오지 않은 계정은 찾을 수 없습니다." />;
    case "quota":
      return <Notice tone="warn" title="오늘 조회 한도 초과" body="오늘 새로 조회할 수 있는 한도를 모두 썼습니다. 이미 조회된 플레이어는 계속 볼 수 있고, 새 플레이어는 내일 다시 시도해 주세요." />;
    case "rate_limited":
      return <Notice tone="warn" title="잠시 후 다시 시도하세요" body={`검색이 너무 잦습니다.${state.retryAfter ? ` ${Math.ceil(state.retryAfter)}초 뒤에 다시 시도하세요.` : ""}`} retry={retry} />;
    case "invalid":
      return <Notice tone="warn" title="배틀태그 형식이 아닙니다" body="이름#1234 형식으로 입력하세요." />;
    case "ok":
      return <Profile v={playerView(state.data, heroes, maps)} />;
  }
}

function Notice({ title, body, tone, retry }: { title: string; body: string; tone?: "info" | "warn"; retry?: () => void }) {
  return (
    <Card className={cx("p-5", tone === "warn" && "border-warn-line", tone === "info" && "border-primary/40")}>
      <h2 className="text-[15px] font-bold text-fg">{title}</h2>
      <p className="mt-1 text-sm text-fg-2">{body}</p>
      {retry && (
        <button type="button" onClick={retry} className="mt-3 rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-fg-2 hover:border-primary hover:text-fg">
          다시 시도
        </button>
      )}
    </Card>
  );
}

function Profile({ v }: { v: PlayerView }) {
  return (
    <div className="space-y-4">
      {v.stale && (
        <p id="player-stale" data-notice={v.notice} className="rounded-lg border border-warn-line bg-warn-bg px-4 py-2.5 text-xs text-warn-fg">
          {v.notice === "quota_exceeded" ? "오늘 조회 한도 초과" : "Heroes Profile 응답 없음"} — {v.fetchedLabel}에 저장된 전적입니다.
        </p>
      )}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 id="player-name" className="text-xl font-extrabold text-fg">
            {v.name}
            <span className="ml-0.5 text-base font-semibold text-muted">{v.tag}</span>
          </h2>
          <span className="rounded-full border border-line px-2 py-0.5 text-2xs font-semibold text-fg-2">{v.regionLabel}</span>
          {v.level !== null && <span className="num text-xs text-muted">레벨 {int(v.level)}</span>}
          <span className="num ml-auto text-2xs text-muted">{v.fetchedLabel}</span>
        </div>
        <dl id="player-summary" className="num mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="전체 게임" value={int(v.games)} />
          <Stat label="승률" value={pct(v.winRate)} className={wrClass(v.winRate)} />
          <Stat label="KDA" value={v.kda === null ? "–" : v.kda.toFixed(2)} />
          <Stat label="MVP" value={pct(v.mvpRate)} />
        </dl>
      </Card>

      <Card aria-labelledby="h-modes">
        <CardHeader id="h-modes" title="모드별 MMR" sub="현재 MMR과 리그 · 승패는 전체 기간 (Heroes Profile)" />
        {v.modes.length ? (
          <div id="player-modes" className="grid grid-cols-2 gap-2 p-3 lg:grid-cols-3">
            {v.modes.map((m) => (
              <div key={m.mode} data-mode={m.mode} className="rounded-lg bg-surface-2 p-3">
                <div className="text-2xs font-semibold text-muted">{m.label}</div>
                <div className={cx("mt-0.5 text-[15px] font-bold", m.tierKey ? LEAGUE_CLASS[m.tierKey] : "text-fg")}>{m.tier ?? "배치 전"}</div>
                <div className="num mt-0.5 text-xs text-fg-2">
                  MMR {m.mmr === null ? "–" : int(m.mmr)} · {int(m.wins)}승 {int(m.losses)}패 · <span className={wrClass(m.winRate)}>{pct(m.winRate)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="p-4 text-sm text-muted">모드별 기록이 없습니다.</p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card aria-labelledby="h-matches" className="lg:col-span-7">
          <CardHeader id="h-matches" title="최근 경기" sub={`최근 ${v.matches.length}경기 ${v.recent.wins}승 ${v.recent.losses}패`} />
          <ul id="player-matches" className="divide-y divide-line">
            {v.matches.map((m) => (
              <li key={m.key} data-result={m.win ? "win" : "loss"} className={cx("flex items-center gap-3 border-l-2 px-4 py-2.5", m.win ? "border-l-pos" : "border-l-neg")}>
                <Portrait src={m.portrait} size={36} role={m.role} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-fg">{m.hero}</span>
                  <span className="block truncate text-2xs text-muted">
                    {m.mode} · {m.map}
                  </span>
                </span>
                <span className="num shrink-0 text-right">
                  <span className={cx("block text-xs font-bold", m.win ? "text-pos" : "text-neg")}>{m.win ? "승리" : "패배"}</span>
                  <span className="block text-2xs text-muted">
                    {m.mmrChange !== null && `${m.mmrChange > 0 ? "+" : ""}${m.mmrChange.toFixed(1)} · `}
                    {m.when}
                  </span>
                </span>
              </li>
            ))}
            {!v.matches.length && <li className="px-4 py-3 text-sm text-muted">최근 경기가 없습니다.</li>}
          </ul>
        </Card>

        <div className="space-y-4 lg:col-span-5">
          <Card aria-labelledby="h-heroes">
            <CardHeader id="h-heroes" title="많이 한 영웅" />
            <ul id="player-heroes" className="divide-y divide-line">
              {v.heroes.map((h) => (
                <li key={h.name} data-hero={h.slug ?? undefined}>
                  <HeroLine h={h} />
                </li>
              ))}
            </ul>
          </Card>
          <Card aria-labelledby="h-roles">
            <CardHeader id="h-roles" title="역할별 승률" />
            <ul id="player-roles" className="space-y-2 p-4">
              {v.roles.map((r) => (
                <li key={r.role} className="flex items-center gap-3 text-xs">
                  <span className="w-20 shrink-0 text-fg-2">{r.label}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                    <span className={cx("block h-full rounded-full", r.winRate >= 50 ? "bg-pos" : "bg-neg")} style={{ width: `${Math.min(100, Math.max(0, r.winRate))}%` }} />
                  </span>
                  <span className={cx("num w-12 text-right", wrClass(r.winRate))}>{pct(r.winRate)}</span>
                </li>
              ))}
            </ul>
          </Card>
          {v.maps.length > 0 && (
            <Card aria-labelledby="h-maps">
              <CardHeader id="h-maps" title="많이 한 전장" />
              <ul id="player-maps" className="divide-y divide-line">
                {v.maps.map((m) => (
                  <li key={m.name} className="num flex items-center justify-between px-4 py-2 text-xs">
                    <span className="text-fg">{m.name}</span>
                    <span className="text-muted">
                      {int(m.games)}게임 · <span className={wrClass(m.winRate)}>{pct(m.winRate)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function HeroLine({ h }: { h: PlayerView["heroes"][number] }) {
  const body = (
    <>
      <Portrait src={h.portrait} size={32} role={h.role} />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{h.name}</span>
      <span className="num shrink-0 text-xs text-muted">
        {int(h.games)}게임 · <span className={wrClass(h.winRate)}>{pct(h.winRate)}</span>
      </span>
    </>
  );
  const cls = "flex items-center gap-3 px-4 py-2";
  return h.href ? (
    <a href={h.href} className={cx(cls, "transition-colors hover:bg-surface-2")}>
      {body}
    </a>
  ) : (
    <span className={cls}>{body}</span>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <dt className="text-2xs text-muted">{label}</dt>
      <dd className={cx("text-[15px] font-bold text-fg", className)}>{value}</dd>
    </div>
  );
}
