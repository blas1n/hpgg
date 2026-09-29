"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { assetUrl, BRACKET_LABEL, daysSince, hotsHref, loadSnapshot, MODE_LABEL, shortDate, snapshotKey, thinSample, type Bracket, type HeroTable, type MapTable, type Meta, type Mode } from "@/data";
import { formulaLine, PRESETS, type Snapshot } from "@/formula";
import { bracketMatches } from "@/lib/shown";
import { DEFAULT_TIER_STATE, parseTierState, resolvePatch, tierSearch, tierTable, visibleRows, type SortKey, type TierRow, type TierState, type TierTable } from "@/lib/tier";
import { Card, cx, Portrait, Segmented } from "../ui";

const pct = (n: number) => `${n.toFixed(1)}%`;
const int = (n: number) => n.toLocaleString("ko-KR");

const COLUMNS: { key: SortKey; label: string; sl?: true; wide?: true }[] = [
  { key: "score", label: "점수" },
  { key: "win_rate", label: "승률" },
  { key: "pick", label: "픽률" },
  { key: "ban_rate", label: "밴률", sl: true },
  { key: "games", label: "표본수", wide: true },
];

// the sample column is hidden below 640px; an opened row must span exactly the visible columns
const WIDE = "(min-width: 640px)";
function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(WIDE);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => matchMedia(WIDE).matches,
    () => false,
  );
}

type Loaded = Record<string, Snapshot | null>; // "latest/qm", "previous/sl_low", … ; null = not published

export interface TierInitial {
  /** The build-time view: Quick Match, all maps, on the patch `resolvePatch` picked at build time. */
  table: TierTable;
  patch: "current" | "previous";
}

export function TierView({ meta, heroes, maps, initial }: { meta: Meta; heroes: HeroTable; maps: MapTable; initial: TierInitial }) {
  const [state, setState] = useState<TierState>(DEFAULT_TIER_STATE);
  const [loaded, setLoaded] = useState<Loaded>({});
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const wide = useWide();

  useEffect(() => {
    setState(parseTierState(location.search));
  }, []);

  const update = (patch: Partial<TierState>, closeRow = true) => {
    setState((s) => {
      const next = { ...s, ...patch };
      const qs = tierSearch(next);
      history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : ""));
      return next;
    });
    if (closeRow) setOpen(null);
    setError(null);
  };

  const { mode, bracket, map, role, sort, dir } = state;
  const sl = mode === "sl";
  const file = snapshotKey(mode, bracket);
  const resolved = resolvePatch(meta, mode, state.patch);
  // a previous-patch bracket file that is missing or of another bracket definition is never shown under this
  // label (lib/shown.ts): the current patch instead, thin as it is
  const { patch, auto } = resolved.patch === "previous" && loaded[`previous/${file}`] === null ? { patch: "current" as const, auto: false } : resolved;
  const dirOf = (p: "current" | "previous") => (p === "previous" ? "previous" : "latest");
  const curKey = `${dirOf(patch)}/${file}`;
  const prevKey = patch === "current" && meta.previous_patch ? `previous/${file}` : null;
  const isInitial = file === "qm" && map === "all" && patch === initial.patch;

  useEffect(() => {
    if (isInitial) return;
    const want = [curKey, prevKey].filter((k): k is string => k !== null && !(k in loaded));
    if (!want.length) return;
    let live = true;
    void Promise.all(
      want.map(async (k) => {
        const [d, f] = k.split("/") as ["latest" | "previous", string];
        try {
          const s = await loadSnapshot(f, d === "previous" ? "previous" : "current", heroes);
          if (bracketMatches(s, bracket)) return [k, s] as const;
          if (d === "latest") setError(`${f}.json 의 리그 구간(${s.league_tier?.join(",") ?? "전체"})이 이 구간 정의와 다릅니다`);
          return [k, null] as const;
        } catch (e) {
          if (d === "latest") setError(e instanceof Error ? e.message : String(e));
          return [k, null] as const;
        }
      }),
    ).then((pairs) => {
      if (live) setLoaded((l) => ({ ...l, ...Object.fromEntries(pairs) }));
    });
    return () => {
      live = false;
    };
  }, [isInitial, curKey, prevKey, loaded, heroes]);

  const snap = loaded[curKey];
  const computed = useMemo(() => {
    if (isInitial) return initial.table;
    if (!snap || (prevKey && !(prevKey in loaded))) return null;
    return tierTable(snap, prevKey ? (loaded[prevKey] ?? null) : null, map, heroes, meta.min_games_for_tier);
  }, [isInitial, initial.table, snap, prevKey, loaded, map, heroes, meta.min_games_for_tier]);
  // while a view loads, keep the last one on screen (dimmed) instead of an empty table
  const last = useRef(initial.table);
  if (computed) last.current = computed;
  const table = computed ?? last.current;
  const busy = computed === null;

  const rows = useMemo(() => visibleRows(table.rows, role, sort, dir), [table.rows, role, sort, dir]);
  const grey = table.grey.filter((g) => role === "all" || g.hero.role === role);
  const mapInfo = map === "all" ? undefined : maps.maps.find((m) => m.name === map);
  const cols = COLUMNS.filter((c) => (!c.sl || sl) && (!c.wide || wide));
  const span = 2 + cols.length;

  // the loading table is the previous view: its patch and match count would be attributed to the new one
  const metaLine = error
    ? `데이터를 불러오지 못했습니다: ${error}`
    : busy
      ? "불러오는 중…"
      : [
        MODE_LABEL[mode] + (sl && bracket !== "all" ? ` · ${BRACKET_LABEL[bracket]}` : ""),
        mapInfo?.ko ?? "전체 전장",
        `패치 ${table.patch}`,
        `${int(table.matches)} 매치`,
        `${shortDate(table.collectedAt)} 갱신`,
      ].join(" · ");

  const sortBy = (key: SortKey) => update(sort === key ? { dir: dir === "desc" ? "asc" : "desc" } : { sort: key, dir: "desc" }, false);

  return (
    <main className="page-x mt-6 space-y-4 pb-10">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-white">영웅 티어</h1>
        <p id="meta-line" className="num mt-0.5 text-xs text-muted">
          {metaLine}
        </p>
      </div>

      {mapInfo && (
        <div id="map-hero" className="relative overflow-hidden rounded-card border border-line bg-surface">
          {mapInfo.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={assetUrl(mapInfo.image)} alt="" className="h-32 w-full object-cover opacity-80 sm:h-40" />
          )}
          <span className="absolute inset-0 bg-gradient-to-t from-surface via-surface/40 to-transparent" />
          <div className="absolute bottom-3 left-4">
            <h2 className="text-xl font-extrabold text-white drop-shadow">{mapInfo.ko}</h2>
            <span className="text-xs text-fg-2">{mapInfo.name} · 폭풍 리그 · 이 전장 표본으로만 계산</span>
          </div>
        </div>
      )}

      <PatchBanner meta={meta} mode={mode} patch={patch} auto={auto} onCurrent={() => update({ patch: "current" })} />

      <Card as="div" className="flex flex-wrap items-center gap-2 p-2.5">
        <Segmented
          label="게임 모드"
          idPrefix="mode"
          value={mode}
          onChange={(m: Mode) => m !== mode && update({ mode: m, map: "all", bracket: "all", patch: "auto" })}
          options={[
            { value: "qm", label: MODE_LABEL.qm },
            { value: "sl", label: MODE_LABEL.sl },
          ]}
        />
        <div id="roles" role="group" aria-label="역할" className="scrollbar-none flex max-w-full gap-0.5 overflow-x-auto">
          {[{ name: "all", ko: "전체" }, ...heroes.roles].map((r) => (
            <button
              key={r.name}
              type="button"
              data-role={r.name}
              aria-pressed={role === r.name}
              onClick={() => update({ role: r.name }, false)}
              className={cx(
                "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-semibold transition-colors",
                role === r.name ? "bg-surface-3 text-fg" : "text-muted hover:text-fg",
              )}
            >
              {r.ko}
            </button>
          ))}
        </div>
        {sl && (
          <div className="flex w-full gap-1.5 sm:ml-auto sm:w-auto">
            <label id="bracket-wrap" className="flex-1 sm:flex-none">
              <span className="sr-only">리그 구간</span>
              <select id="bracket" value={bracket} onChange={(e) => update({ bracket: e.target.value as Bracket })} className={SELECT}>
                {(Object.keys(BRACKET_LABEL) as Bracket[]).map((b) => (
                  <option key={b} value={b}>
                    {BRACKET_LABEL[b]}
                  </option>
                ))}
              </select>
            </label>
            <label id="map-wrap" className="flex-1 sm:flex-none">
              <span className="sr-only">전장</span>
              <select id="map" value={map} onChange={(e) => update({ map: e.target.value })} className={SELECT}>
                <option value="all">전체 전장</option>
                {maps.maps.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.ko}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </Card>

      <Card as="div" className="overflow-hidden">
        <table id="table" aria-busy={busy} className={cx("num w-full table-fixed border-collapse text-[13px] transition-opacity sm:text-sm", busy && "opacity-50")}>
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th data-col="rank" className="w-11 py-2.5 pl-3 text-left font-semibold sm:w-16 sm:pl-4">
                순위
              </th>
              <th data-col="hero" className="py-2.5 pl-1 text-left font-semibold">
                영웅
              </th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  data-col={c.key}
                  data-sort={c.key}
                  aria-sort={sort === c.key ? (dir === "desc" ? "descending" : "ascending") : undefined}
                  className={cx("py-2.5 pr-2 text-right font-semibold sm:pr-4", c.key === "games" ? "w-24" : "w-14 sm:w-24")}
                >
                  <button type="button" onClick={() => sortBy(c.key)} className={cx("whitespace-nowrap transition-colors hover:text-fg", sort === c.key && "text-fg")}>
                    {c.label}
                    {sort === c.key && <span className="text-primary">{dir === "desc" ? " ▾" : " ▴"}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody id="rows">
            {rows.map((r) => (
              <HeroRow
                key={r.hero.slug}
                r={r}
                cols={cols.map((c) => c.key)}
                n={table.rows.length}
                hasPrevious={table.hasPrevious}
                sl={sl}
                span={span}
                mode={mode}
                open={open === r.hero.slug}
                onToggle={() => setOpen((o) => (o === r.hero.slug ? null : r.hero.slug))}
              />
            ))}
          </tbody>
        </table>
      </Card>

      {grey.length > 0 && (
        <section id="grey-wrap">
          <h2 className="mb-2 text-sm font-bold text-muted">
            표본 부족 <span className="text-xs font-normal">{meta.min_games_for_tier}게임 미만 · 티어 없음</span>
          </h2>
          <div id="grey" className="flex flex-wrap gap-1.5">
            {grey.map((g) => (
              <span key={g.hero.slug} data-hero={g.hero.slug} className="rounded-md border border-line px-2 py-1 text-xs text-muted">
                {g.hero.ko} · {g.games}게임
              </span>
            ))}
          </div>
        </section>
      )}

      <Formula sl={sl} min={meta.min_games_for_tier} />
    </main>
  );
}

const SELECT = "w-full rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg sm:w-auto";

function HeroRow({ r, cols, n, hasPrevious, sl, span, mode, open, onToggle }: { r: TierRow; cols: SortKey[]; n: number; hasPrevious: boolean; sl: boolean; span: number; mode: Mode; open: boolean; onToggle: () => void }) {
  const cell: Record<SortKey, string> = {
    score: (r.score >= 0 ? "+" : "") + r.score.toFixed(0),
    win_rate: pct(r.win_rate),
    pick: pct(r.pick),
    ban_rate: pct(r.ban_rate),
    games: int(r.games),
  };
  return (
    <Fragment>
      <tr
        data-hero={r.hero.slug}
        data-tier={r.tier}
        tabIndex={0}
        role="button"
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className={cx("cursor-pointer border-b border-line/70 transition-colors hover:bg-surface-2", open && "bg-surface-2")}
      >
        <td data-col="rank" className="py-2 pl-3 sm:pl-4">
          <span data-v className="block font-bold text-fg">
            {r.rank}
          </span>
          {hasPrevious && <Delta rank={r.rank} prev={r.prevRank} />}
        </td>
        <td data-col="hero" className="overflow-hidden py-2 pl-1">
          <span className="flex min-w-0 items-center gap-2.5">
            <Portrait src={r.hero.portrait} size={34} tier={r.tier} role={r.hero.role || undefined} />
            <span className="min-w-0 sm:flex sm:items-baseline sm:gap-1.5">
              <span data-name className="block truncate font-semibold text-fg">
                {r.hero.ko}
              </span>
              <span className="hidden truncate text-2xs text-muted sm:block">
                {r.hero.name}
                {r.hero.role_ko && ` · ${r.hero.role_ko}`}
              </span>
            </span>
          </span>
        </td>
        {cols.map((k) => (
          <td key={k} data-col={k} className={cx("py-2 pr-2 text-right sm:pr-4", k === "score" ? (r.score < 0 ? "font-bold text-neg" : "font-bold text-fg") : "text-fg-2", k === "win_rate" && (r.win_rate >= 50 ? "text-pos" : "text-neg"))}>
            <span data-v>{cell[k]}</span>
          </td>
        ))}
      </tr>
      {open && (
        <tr data-detail={r.hero.slug} className="border-b border-line/70 bg-surface-2">
          <td colSpan={span} className="px-3 pb-3 sm:px-4">
            <dl className="grid grid-cols-3 gap-1.5 pt-1 sm:grid-cols-5">
              <Stat k="순위" v={`${r.rank} / ${n}`} />
              <Stat k="승률 (95%)" v={`${pct(r.win_rate)} ±${r.wrHalf.toFixed(1)}`} />
              <Stat k="표본" v={`${int(r.games)}게임`} />
              <Stat k="픽률" v={pct(r.pick)} />
              {sl && <Stat k="밴률" v={pct(r.ban_rate)} id="d-ban" />}
            </dl>
            <a data-link href={hotsHref.hero(r.hero.slug, mode)} className="mt-2 inline-flex items-center rounded-md border border-line px-2.5 py-1.5 text-xs font-semibold text-fg-2 transition-colors hover:border-primary hover:text-primary">
              영웅 상세 →
            </a>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function Stat({ k, v, id }: { k: string; v: string; id?: string }) {
  return (
    <div className="rounded-md bg-surface px-2.5 py-1.5" data-stat={id}>
      <dt className="text-2xs text-muted">{k}</dt>
      <dd className="text-[13px] text-fg">{v}</dd>
    </div>
  );
}

/** ▲3 / ▼2 / — 0 / NEW against the previous patch (NEW = unranked there). */
function Delta({ rank, prev }: { rank: number; prev: number | null }) {
  const d = prev === null ? null : prev - rank;
  const [text, tone] = d === null ? ["NEW", "bg-primary/15 text-primary"] : d === 0 ? ["— 0", "bg-surface-3 text-muted"] : d > 0 ? [`▲ ${d}`, "bg-pos/15 text-pos"] : [`▼ ${-d}`, "bg-neg/15 text-neg"];
  return (
    <span data-delta={d ?? "new"} title={prev === null ? "직전 패치엔 표본 부족" : `직전 패치 #${prev}`} className={cx("mt-0.5 inline-block whitespace-nowrap rounded-full px-1.5 text-[10px] font-bold", tone)}>
      {text}
    </span>
  );
}

function PatchBanner({ meta, mode, patch, auto, onCurrent }: { meta: Meta; mode: Mode; patch: "current" | "previous"; auto: boolean; onCurrent: () => void }) {
  const days = daysSince(meta.patch_started_at);
  const note = patch === "previous" || (!auto && meta.previous_patch && thinSample(meta, mode));
  if (!note) return null;
  return (
    <div id="patch-banner" className="rounded-lg border border-[#6b5416] bg-[#3b2f12] px-3 py-2.5 text-[13px] text-[#ffd8a8]">
      {patch === "previous" ? (
        <>
          패치 {meta.current_patch} 후 {days}일, 표본이 적어 <b>이전 패치({meta.previous_patch})</b> 기준으로 보여줍니다.{" "}
          <button type="button" onClick={onCurrent} className="ml-1 rounded-md bg-[#6b5416] px-2 py-0.5 font-semibold text-white">
            현재 패치 보기
          </button>
        </>
      ) : (
        <>
          패치 {meta.current_patch} 후 {days}일 — 표본이 아직 적습니다.
        </>
      )}
    </div>
  );
}

function Formula({ sl, min }: { sl: boolean; min: number }) {
  return (
    <div className="space-y-2">
      <p id="formula" className="rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs [overflow-wrap:anywhere] text-fg-2">
        {formulaLine(PRESETS.aichi, sl)} · 승률은 표본 수축(k=500) · {min}게임 미만 제외 · 상위 6% S / 24% A / 54% B / 82% C / 94% D
      </p>
      <details className="text-[13px]">
        <summary className="cursor-pointer text-secondary">자세히</summary>
        <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-surface p-3 text-xs [overflow-wrap:anywhere] text-fg-2">
          {`WRs   = 50 + (승률 − 50) × 게임수 / (게임수 + 500)
점수  = 픽률 × (WRs − 50) × 3${sl ? " + 밴률 × 1" : "   (빠른 대전은 밴이 없음)"}
티어  = ${min}게임 이상인 영웅을 점수순으로 세워 누적 비율로 자름 (S 6% · A 24% · B 54% · C 82% · D 94% · F 나머지)
        경계는 단조 증가, 티어마다 최소 1명
승률 ± 는 Wilson 95% 구간. 전장을 고르면 그 전장의 표본으로만 계산합니다.
같은 데이터라도 공식이 다르면 티어가 다릅니다 — 이 사이트는 공식을 숨기지 않습니다.`}
        </pre>
      </details>
    </div>
  );
}
