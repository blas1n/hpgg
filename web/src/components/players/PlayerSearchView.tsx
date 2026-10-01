"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHead } from "@/components/PageHead";
import { HP_EMBED_URL, readHpMessage } from "@/lib/hpUpload";
import type { HeroTable, MapTable } from "@/data";
import { useLocale, useT } from "@/i18n/client";
import { fetchPlayer, isRegion, parseBattletag, playersHref, playerView, type PlayerResult, type PlayerView, type Region } from "@/lib/players";
import { Card, CardHeader, cx, Portrait } from "../ui";
import { fetchMatches, type MatchesResult } from "@/lib/matches";
import { MatchHistory } from "./MatchHistory";
import { PlayerSearchForm } from "./PlayerSearchForm";

type State = { kind: "idle" } | { kind: "loading"; tag: string } | PlayerResult;
type Games = { kind: "loading" } | MatchesResult;

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
  const t = useT();
  const locale = useLocale();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [games, setGames] = useState<Games>({ kind: "loading" });
  const [query, setQuery] = useState<{ tag: string; region: Region } | null>(null);
  const [formKey, setFormKey] = useState(0);

  const run = useCallback(async (tag: string, region: Region) => {
    setQuery({ tag, region });
    setState({ kind: "loading", tag });
    setGames({ kind: "loading" });
    // the match list is a second call so the profile is not held up by Heroes Profile's job queue
    const matches = fetchMatches(tag, region).then(setGames);
    setState(await fetchPlayer(tag, region));
    await matches;
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
    history.pushState(null, "", playersHref(locale, tag, region));
    void run(tag, region);
  };

  return (
    <main className="page-x mt-6 space-y-4 pb-10">
      <PageHead title={t.players.title}>
        <p className="mt-0.5 text-xs text-muted">{t.players.sub}</p>
      </PageHead>
      <PlayerSearchForm key={formKey} initialTag={query?.tag ?? ""} initialRegion={query?.region ?? "KR"} onSearch={search} className="max-w-xl" />
      <section id="player-result" data-state={state.kind} aria-live="polite" aria-busy={state.kind === "loading"}>
        <Result state={state} games={games} heroes={heroes} maps={maps} retry={query ? () => void run(query.tag, query.region) : undefined} />
      </section>
      {/* remounted when a search finds nobody, so it opens then and stays under the visitor's control otherwise */}
      <UploadGuide key={state.kind === "not_found" ? "not-found" : "default"} open={state.kind === "not_found"} />
    </main>
  );
}

function Result({ state, games, heroes, maps, retry }: { state: State; games: Games; heroes: HeroTable; maps: MapTable; retry?: () => void }) {
  const t = useT().players;
  const locale = useLocale();
  switch (state.kind) {
    case "idle":
      return <Notice title={t.idleTitle} body={t.idleBody} />;
    case "loading":
      return (
        <Card className="animate-pulse p-6">
          <p className="text-sm text-muted">{t.loading(state.tag)}</p>
        </Card>
      );
    case "offline":
      return <Notice tone="info" title={t.offlineTitle} body={t.offlineBody} />;
    case "error":
      return <Notice tone="warn" title={t.errorTitle} body={t.errorBody} retry={retry} />;
    case "not_found":
      return <Notice title={t.notFoundTitle} body={t.notFoundBody} />;
    case "private":
      return <Notice title={t.privateTitle} body={t.privateBody} />;
    case "quota":
      return <Notice tone="warn" title={t.quotaTitle} body={t.quotaBody} />;
    case "rate_limited":
      return <Notice tone="warn" title={t.rateTitle} body={t.rateBody + (state.retryAfter ? t.rateRetry(String(Math.ceil(state.retryAfter))) : "")} retry={retry} />;
    case "invalid":
      return <Notice tone="warn" title={t.invalidTitle} body={t.invalidBody} />;
    case "ok":
      return <Profile v={playerView(state.data, heroes, maps, locale)} games={games} heroes={heroes} maps={maps} />;
  }
}

const HP_UPLOAD = "https://www.heroesprofile.com/Upload";

/** Why a player may be missing (no official API: records come from replays uploaded to Heroes Profile) and how to fix
 *  it. Always on the page, folded; opened when a search finds nobody. Paths from the Heroes Profile uploaders' sources. */
function UploadGuide({ open }: { open: boolean }) {
  const g = useT().players.guide;
  const link = (
    <a href={HP_UPLOAD} target="_blank" rel="noopener" className="font-semibold text-primary underline-offset-2 hover:underline">
      {g.link}
    </a>
  );
  return (
    <details id="upload-guide" open={open} className="group rounded-card border border-line bg-surface p-4 text-sm text-fg-2">
      <summary className="cursor-pointer list-none">
        <span className="text-fg">{g.summary}</span> <span className="whitespace-nowrap font-semibold text-primary">{g.more} <span className="inline-block transition-transform group-open:rotate-90">›</span></span>
      </summary>
      <div className="mt-3 space-y-3">
        <p>{g.why}</p>
        <div>
          <h3 className="font-bold text-fg">{g.autoTitle}</h3>
          <p className="mt-0.5">
            {g.autoBody} {link}
          </p>
        </div>
        <div>
          <h3 className="font-bold text-fg">{g.pastTitle}</h3>
          <p className="mt-0.5">
            {g.pastBody}
          </p>
          <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="font-semibold text-fg">{g.windows}</dt>
            <dd>
              <code className="break-all rounded bg-surface-3 px-1.5 py-0.5 text-fg">{g.windowsPath}</code>
            </dd>
            <dt className="font-semibold text-fg">{g.mac}</dt>
            <dd>
              <code className="break-all rounded bg-surface-3 px-1.5 py-0.5 text-fg">{g.macPath}</code>
            </dd>
          </dl>
          <HpUploader />
        </div>
        <p className="text-xs text-muted">{g.leaderboard}</p>
        <p className="text-xs text-muted">{g.after}</p>
      </div>
    </details>
  );
}

/** Heroes Profile's own uploader in an iframe (lib/hpUpload.ts): it grows to fit, and when its queue empties we say
 *  how many games are on Heroes Profile and when to search again. */
function HpUploader() {
  const g = useT().players.guide;
  const [height, setHeight] = useState(520);
  const [found, setFound] = useState<number | null>(null);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      const m = readHpMessage(e);
      if (m?.type === "resize") setHeight(m.height);
      else if (m?.type === "complete") setFound(m.uploaded + m.duplicates);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);
  return (
    <div className="mt-2 space-y-2">
      <iframe id="hp-uploader" src={HP_EMBED_URL} title={g.uploaderTitle} loading="lazy" className="w-full rounded-lg border-0" style={{ height }} />
      {found !== null && (
        <p id="upload-done" role="status" className="rounded-lg border border-primary/40 bg-surface px-3 py-2 text-fg">
          {g.done(String(found))}
        </p>
      )}
    </div>
  );
}

function Notice({ title, body, tone, retry }: { title: string; body: string; tone?: "info" | "warn"; retry?: () => void }) {
  const t = useT();
  return (
    <Card className={cx("p-5", tone === "warn" && "border-warn-line", tone === "info" && "border-primary/40")}>
      <h2 className="text-[15px] font-bold text-fg">{title}</h2>
      <p className="mt-1 text-sm text-fg-2">{body}</p>
      {retry && (
        <button type="button" onClick={retry} className="mt-3 rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-fg-2 hover:border-primary hover:text-fg">
          {t.players.retry}
        </button>
      )}
    </Card>
  );
}

function Profile({ v, games, heroes, maps }: { v: PlayerView; games: Games; heroes: HeroTable; maps: MapTable }) {
  const t = useT().players;
  return (
    <div className="space-y-4">
      {v.stale && (
        <p id="player-stale" data-notice={v.notice} className="rounded-lg border border-warn-line bg-warn-bg px-4 py-2.5 text-xs text-warn-fg">
          {v.notice === "quota_exceeded" ? t.staleQuota : t.staleUpstream}
          {t.staleTail(v.fetchedLabel)}
        </p>
      )}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 id="player-name" className="text-xl font-extrabold text-fg">
            {v.name}
            <span className="ml-0.5 text-base font-semibold text-muted">{v.tag}</span>
          </h2>
          <span className="rounded-full border border-line px-2 py-0.5 text-2xs font-semibold text-fg-2">{v.regionLabel}</span>
          {v.level !== null && <span className="num text-xs text-muted">{t.level(int(v.level))}</span>}
          <span className="num ml-auto text-2xs text-muted">{v.fetchedLabel}</span>
        </div>
        <dl id="player-summary" className="num mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label={t.totalGames} value={int(v.games)} />
          <Stat label={t.winRate} value={pct(v.winRate)} className={wrClass(v.winRate)} />
          <Stat label="KDA" value={v.kda === null ? "–" : v.kda.toFixed(2)} />
          <Stat label="MVP" value={pct(v.mvpRate)} />
        </dl>
      </Card>

      <Card aria-labelledby="h-modes">
        <CardHeader id="h-modes" title={t.modesTitle} sub={t.modesSub} />
        {v.modes.length ? (
          <div id="player-modes" className="grid grid-cols-2 gap-2 p-3 lg:grid-cols-3">
            {v.modes.map((m) => (
              <div key={m.mode} data-mode={m.mode} className="rounded-lg bg-surface-2 p-3">
                <div className="text-2xs font-semibold text-muted">{m.label}</div>
                <div className={cx("mt-0.5 text-[15px] font-bold", m.tierKey ? LEAGUE_CLASS[m.tierKey] : "text-fg")}>{m.tier ?? t.unplaced}</div>
                <div className="num mt-0.5 text-xs text-fg-2">
                  MMR {m.mmr === null ? "–" : int(m.mmr)} · {t.record(int(m.wins), int(m.losses))} · <span className={wrClass(m.winRate)}>{pct(m.winRate)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="p-4 text-sm text-muted">{t.noModes}</p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-12">
        {games.kind === "ok" ? (
          <div className="lg:col-span-8">
            <MatchHistory data={games.data} heroes={heroes} maps={maps} />
          </div>
        ) : (
        <Card aria-labelledby="h-matches" className="lg:col-span-7">
          <CardHeader id="h-matches" title={t.matchesTitle} sub={t.matchesSub(String(v.matches.length), String(v.recent.wins), String(v.recent.losses))} />
          {games.kind === "loading" && <p id="games-loading" className="border-b border-line px-4 py-2 text-2xs text-muted">{t.games.loading}</p>}
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
                  <span className={cx("block text-xs font-bold", m.win ? "text-pos" : "text-neg")}>{m.win ? t.win : t.loss}</span>
                  <span className="block text-2xs text-muted">
                    {m.mmrChange !== null && `${m.mmrChange > 0 ? "+" : ""}${m.mmrChange.toFixed(1)} · `}
                    {m.when}
                  </span>
                </span>
              </li>
            ))}
            {!v.matches.length && <li className="px-4 py-3 text-sm text-muted">{t.noMatches}</li>}
          </ul>
        </Card>
        )}

        <div className={cx("space-y-4", games.kind === "ok" ? "lg:col-span-4" : "lg:col-span-5")}>
          <Card aria-labelledby="h-heroes">
            <CardHeader id="h-heroes" title={t.heroesTitle} />
            <ul id="player-heroes" className="divide-y divide-line">
              {v.heroes.map((h) => (
                <li key={h.name} data-hero={h.slug ?? undefined}>
                  <HeroLine h={h} />
                </li>
              ))}
            </ul>
          </Card>
          <Card aria-labelledby="h-roles">
            <CardHeader id="h-roles" title={t.rolesTitle} />
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
              <CardHeader id="h-maps" title={t.mapsTitle} />
              <ul id="player-maps" className="divide-y divide-line">
                {v.maps.map((m) => (
                  <li key={m.name} className="num flex items-center justify-between px-4 py-2 text-xs">
                    <span className="text-fg">{m.name}</span>
                    <span className="text-muted">
                      {t.gamesWr(int(m.games))}
                      <span className={wrClass(m.winRate)}>{pct(m.winRate)}</span>
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
  const t = useT().players;
  const body = (
    <>
      <Portrait src={h.portrait} size={32} role={h.role} />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{h.name}</span>
      <span className="num shrink-0 text-xs text-muted">
        {t.gamesWr(int(h.games))}
        <span className={wrClass(h.winRate)}>{pct(h.winRate)}</span>
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
