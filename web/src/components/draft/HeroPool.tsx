"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { hotsHref } from "@/data";
import { useLocale, useT } from "@/i18n/client";
import { chooseRegion, type Me } from "@/lib/account";
import type { DraftHero } from "@/lib/draft";
import { filterHeroes } from "@/lib/heroes";
import { REGIONS, type Region } from "@/lib/players";
import { clearPool, setPoolHero, syncPool, type PoolCandidate } from "@/lib/pool";
import { Card, cx, Portrait } from "../ui";

/** Where a hero in the pool came from, as far as this visit knows: a sync (games when known) or the member's own click. */
export type PoolSource = { games?: number } | "manual";

type Result =
  | { kind: "ok"; added: string[]; candidates: PoolCandidate[]; minGames: number; stale: boolean }
  | { kind: "none" | "private" | "unavailable" };

const BTN = "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-bold transition-colors disabled:cursor-wait disabled:opacity-60";
const PRIMARY = cx(BTN, "bg-primary text-primary-ink hover:opacity-90");
const GHOST = cx(BTN, "border border-line text-fg-2 hover:border-line-strong hover:text-fg");

/**
 * 내 영웅풀 (#28, stage D): the member's own list, kept by hand (the grid, the chips) or filled from this season's
 * Storm League record (the sync). Every change shows at once and is undone with a short notice when the API says no.
 */
export function HeroPool({
  heroes,
  roles,
  pool,
  setPool,
  sources,
  setSources,
  me,
  setMe,
}: {
  heroes: DraftHero[];
  roles: { name: string; ko: string }[];
  pool: string[];
  setPool: Dispatch<SetStateAction<string[] | null>>;
  sources: Record<string, PoolSource>;
  setSources: Dispatch<SetStateAction<Record<string, PoolSource>>>;
  me: Me;
  setMe: (m: Me) => void;
}) {
  const t = useT();
  const p = t.pool;
  const locale = useLocale();
  const [role, setRole] = useState("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [askRegion, setAskRegion] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byName = useMemo(() => new Map(heroes.map((h) => [h.name, h])), [heroes]);
  const mine = pool.map((n) => byName.get(n)).filter((h): h is DraftHero => !!h);
  const has = new Set(pool);
  const grid = filterHeroes(heroes, role, query);

  const put = (name: string, include: boolean) =>
    setPool((cur) => {
      const list = cur ?? [];
      return include ? (list.includes(name) ? list : [...list, name]) : list.filter((x) => x !== name);
    });

  async function choose(h: DraftHero, include: boolean, source: PoolSource) {
    setError(null);
    put(h.name, include);
    if (include) setSources((s) => ({ ...s, [h.name]: source }));
    if (!(await setPoolHero(h.name, include))) {
      put(h.name, !include);
      setError(p.saveFailed);
    }
  }

  async function clear() {
    const before = pool;
    setConfirming(false);
    setError(null);
    setPool([]);
    setResult(null);
    if (!(await clearPool())) {
      setPool(before);
      setError(p.saveFailed);
    }
  }

  async function sync() {
    setBusy(true);
    setError(null);
    setConfirming(false);
    const r = await syncPool();
    setBusy(false);
    if (r.status === "region_required") {
      setResult(null);
      setAskRegion(true);
      return;
    }
    setAskRegion(false);
    if (r.status === "ok") {
      setPool((cur) => [...(cur ?? []), ...r.added.filter((n) => !(cur ?? []).includes(n))]);
      const games = new Map(r.addedRecords.map((c) => [c.hero, c.games]));
      setSources((s) => ({ ...s, ...Object.fromEntries(r.added.map((n) => [n, games.has(n) ? { games: games.get(n) } : {}])) }));
      setResult({ kind: "ok", added: r.added, candidates: r.candidates, minGames: r.minGames, stale: r.stale });
    } else setResult({ kind: r.status === "not_found" ? "none" : r.status === "private" ? "private" : "unavailable" });
  }

  async function pickRegion(region: Region) {
    setBusy(true);
    setError(null);
    const ok = await chooseRegion(region);
    setBusy(false);
    if (!ok) {
      setError(t.account.regionFailed);
      return;
    }
    setMe({ ...me, region });
    await sync();
  }

  const candidates = result?.kind === "ok" ? result.candidates.filter((c) => !has.has(c.hero) && byName.has(c.hero)) : [];

  return (
    <Card as="div" className="space-y-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="text-base font-bold text-fg">{p.title}</h2>
          <p className="mt-0.5 break-keep text-xs text-fg-2">{p.intro}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button id="pool-sync" type="button" disabled={busy} aria-busy={busy} onClick={() => void sync()} className={PRIMARY}>
            <svg aria-hidden viewBox="0 0 16 16" className={cx("size-3.5", busy && "animate-spin")} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" />
            </svg>
            {busy ? p.syncing : p.sync}
          </button>
          <button id="pool-clear" type="button" disabled={!pool.length || confirming} onClick={() => setConfirming(true)} className={cx(GHOST, "disabled:cursor-default disabled:opacity-40")}>
            {p.clear}
          </button>
        </div>
      </div>

      {confirming && (
        <div id="pool-clear-confirm" role="group" aria-labelledby="pool-clear-text" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
          <p id="pool-clear-text" className="text-[13px] text-fg">
            {p.clearConfirm(pool.length)}
          </p>
          <div className="flex gap-1.5">
            <button id="pool-clear-no" type="button" onClick={() => setConfirming(false)} className={GHOST}>
              {p.clearNo}
            </button>
            <button id="pool-clear-yes" type="button" onClick={() => void clear()} className={cx(BTN, "border border-neg text-neg hover:bg-surface-3")}>
              {p.clearYes}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p id="pool-error" role="alert" className="rounded-lg border border-neg/60 bg-surface-2 px-3 py-2 text-[13px] text-neg">
          {error}
        </p>
      )}

      {askRegion && (
        <div id="pool-region" className="rounded-lg border border-line bg-surface-2 p-3">
          <p id="pool-region-label" className="text-[13px] font-semibold text-fg">
            {p.regionHead}
          </p>
          <p className="mt-0.5 break-keep text-xs text-fg-2">{p.regionBody}</p>
          <div role="group" aria-labelledby="pool-region-label" className="mt-2 grid max-w-xs grid-cols-3 gap-0.5 rounded-lg border border-line bg-surface p-0.5">
            {REGIONS.map((r) => (
              <button key={r} type="button" data-region={r} disabled={busy} onClick={() => void pickRegion(r)} className="rounded-md px-2 py-1.5 text-[13px] font-semibold text-fg-2 transition-colors hover:bg-surface-3 hover:text-fg disabled:cursor-wait">
                {t.players.regions[r]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div id="pool-result" role="status" aria-live="polite">
        {result && (
          <div className="space-y-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[13px] text-fg-2">
            {result.kind === "ok" ? (
              <>
                <p className="break-keep">
                  {result.added.length ? (
                    <>
                      <b className="text-fg">{p.addedHead(result.added.length)}</b>
                      {p.addedTail(result.added.map((n) => byName.get(n)?.ko ?? n).join(", "), result.minGames)}
                    </>
                  ) : (
                    p.noneNew(result.minGames)
                  )}
                </p>
                {result.stale && <p className="text-xs text-muted">{p.stale}</p>}
                {candidates.length > 0 && (
                  <div>
                    <p className="text-xs text-muted">{p.candidatesHead(result.minGames)}</p>
                    <div id="pool-candidates" className="mt-1.5 flex flex-wrap gap-1.5">
                      {candidates.map((c) => {
                        const h = byName.get(c.hero)!;
                        return (
                          <button
                            key={c.hero}
                            type="button"
                            data-hero={h.slug}
                            aria-label={`${p.add(h.ko)} · ${p.games(c.games)}`}
                            onClick={() => void choose(h, true, { games: c.games })}
                            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-strong bg-surface py-0.5 pl-0.5 pr-2.5 text-[13px] font-semibold text-fg hover:border-primary"
                          >
                            <Portrait src={h.portrait} size={22} className="[&_img]:rounded-full [&_span]:rounded-full" />
                            {h.ko}
                            <span className="num text-xs font-normal text-muted">{p.games(c.games)}</span>
                            <span aria-hidden className="font-bold text-primary">＋</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : result.kind === "unavailable" ? (
              <p>{p.unavailable}</p>
            ) : (
              <p className="break-keep">
                <b className="text-fg">{result.kind === "none" ? p.noRecordHead : p.privateHead}</b> {result.kind === "none" ? p.noRecordBody : p.privateBody}{" "}
                {result.kind === "none" && (
                  <a href={`${hotsHref(locale).players}#upload-guide`} className="font-semibold text-primary underline-offset-2 hover:underline">
                    {p.uploadGuide}
                  </a>
                )}
              </p>
            )}
          </div>
        )}
      </div>

      <section aria-labelledby="pool-mine-title">
        <h3 id="pool-mine-title" className="text-[13px] font-bold text-fg">
          {p.mine} <span className="num font-semibold text-muted">{p.count(mine.length)}</span>
        </h3>
        {mine.length ? (
          <ul id="pool-mine" className="mt-2 flex flex-wrap gap-1.5">
            {mine.map((h) => {
              const src = sources[h.name];
              const label = src === "manual" ? p.manual : src?.games ? p.fromGames(src.games) : null;
              return (
                <li key={h.name} data-hero={h.slug} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface-2 py-0.5 pl-0.5 pr-1 text-[13px] font-semibold text-fg">
                  <Portrait src={h.portrait} size={24} className="[&_img]:rounded-full [&_span]:rounded-full" />
                  <span className="truncate">{h.ko}</span>
                  {label && <span className="whitespace-nowrap text-2xs font-normal text-muted">{label}</span>}
                  <button type="button" aria-label={p.remove(h.ko)} onClick={() => void choose(h, false, "manual")} className="grid size-6 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-fg">
                    <svg aria-hidden viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="m3 3 6 6M9 3l-6 6" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p id="pool-mine" className="mt-2 break-keep rounded-lg border border-dashed border-line px-3 py-2.5 text-xs text-muted">
            {p.empty}
          </p>
        )}
      </section>

      <section aria-labelledby="pool-all-title" className="space-y-2 border-t border-line pt-3">
        <h3 id="pool-all-title" className="text-[13px] font-bold text-fg">
          {p.all}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <div id="pool-roles" role="group" aria-label={t.common.role} className="scrollbar-none flex max-w-full gap-0.5 overflow-x-auto">
            {[{ name: "all", ko: t.common.allRoles }, ...roles].map((r) => (
              <button
                key={r.name}
                type="button"
                data-role={r.name}
                aria-pressed={role === r.name}
                onClick={() => setRole(r.name)}
                className={cx("shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-semibold transition-colors", role === r.name ? "bg-surface-3 text-fg" : "text-muted hover:text-fg")}
              >
                {r.ko}
              </button>
            ))}
          </div>
          <label className="w-full lg:ml-auto lg:w-48">
            <span className="sr-only">{t.common.heroSearch}</span>
            <input
              id="pool-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.heroes.searchPlaceholder}
              autoComplete="off"
              className="w-full rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-[13px] text-fg placeholder:text-muted"
            />
          </label>
        </div>
        <div id="pool-heroes" className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5">
          {grid.map((h) => {
            const on = has.has(h.name);
            return (
              <button
                key={h.slug}
                type="button"
                data-hero={h.slug}
                aria-pressed={on}
                onClick={() => void choose(h, !on, "manual")}
                className={cx("relative flex flex-col items-center gap-1 rounded-lg border p-1.5 transition-colors", on ? "border-primary bg-surface-3" : "border-line bg-surface hover:border-line-strong")}
              >
                <Portrait src={h.portrait} size={40} role={h.role || undefined} className={on ? undefined : "opacity-80"} />
                <span className={cx("w-full truncate text-center text-2xs font-semibold", on ? "text-fg" : "text-fg-2")}>{h.ko}</span>
                {on && (
                  <span aria-hidden className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-primary text-primary-ink">
                    <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m2.5 6.2 2.3 2.3 4.7-5" />
                    </svg>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>
    </Card>
  );
}
