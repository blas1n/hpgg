"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { assetUrl, BRACKET_LABEL, daysSince, hotsHref, loadSnapshot, MODE_LABEL, REGION_LABEL, REGIONS, regionSample, shortDate, snapshotKey, thinSample, type Bracket, type HeroTable, type MapTable, type Meta, type Mode, type Region } from "@/data";
import { formulaDetail, formulaLine, PRESETS, type Preset, type Snapshot, type Tier } from "@/formula";
import { bracketMatches, regionMatches } from "@/lib/shown";
import { DEFAULT_TIER_STATE, formatScore, parseTierState, resolvePatch, tierSearch, tierTable, visibleRows, type PresetId, type SortKey, type TierRow, type TierState, type TierTable } from "@/lib/tier";
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

const PRESET_LABEL: Record<PresetId, string> = { aichi: "아이치 공식 (기본)", additive: "가산식", winrate: "승률만" };

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

  const { mode, bracket, region, map, role, sort, dir } = state;
  const preset = PRESETS[state.preset];
  const sl = mode === "sl";
  const file = snapshotKey(mode, bracket, region);
  const resolved = resolvePatch(meta, mode, state.patch, file);
  // a previous-patch bracket file that is missing or of another bracket definition is never shown under this
  // label (lib/shown.ts): the current patch instead, thin as it is
  const { patch, auto } = resolved.patch === "previous" && loaded[`previous/${file}`] === null ? { patch: "current" as const, auto: false } : resolved;
  const dirOf = (p: "current" | "previous") => (p === "previous" ? "previous" : "latest");
  const curKey = `${dirOf(patch)}/${file}`;
  const prevKey = patch === "current" && meta.previous_patch ? `previous/${file}` : null;
  const isInitial = file === "qm" && map === "all" && patch === initial.patch && state.preset === "aichi";

  useEffect(() => {
    if (isInitial) return;
    const want = [curKey, prevKey].filter((k): k is string => k !== null && !(k in loaded));
    if (!want.length) return;
    let live = true;
    void Promise.all(
      want.map(async (k) => {
        const [d, f] = k.split("/") as ["latest" | "previous", string];
        try {
          // a region is published only once it has been collected (meta lists it); don't ask for a file that isn't there
          if (region !== "all" && d === "latest" && !meta.modes[f]) {
            setError(`${REGION_LABEL[region]}은(는) 아직 수집되지 않았습니다 — 지역은 하루 한 곳씩 돌아가며 수집합니다`);
            return [k, null] as const;
          }
          const s = await loadSnapshot(f, d === "previous" ? "previous" : "current", heroes);
          if (bracketMatches(s, bracket) && regionMatches(s, region)) return [k, s] as const;
          if (d === "latest") setError(`${f}.json 의 리그 구간(${s.league_tier?.join(",") ?? "전체"}) 또는 지역(${s.region ?? "전체"})이 이 선택과 다릅니다`);
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
  }, [isInitial, curKey, prevKey, loaded, heroes, bracket, region, meta.modes]);

  const snap = loaded[curKey];
  const computed = useMemo(() => {
    if (isInitial) return initial.table;
    if (!snap || (prevKey && !(prevKey in loaded))) return null;
    return tierTable(snap, prevKey ? (loaded[prevKey] ?? null) : null, map, heroes, meta.min_games_for_tier, preset);
  }, [isInitial, initial.table, snap, prevKey, loaded, map, heroes, meta.min_games_for_tier, preset]);
  // while a view loads, keep the last one on screen (dimmed) instead of an empty table
  const last = useRef(initial.table);
  if (computed) last.current = computed;
  const table = computed ?? last.current;
  const busy = computed === null;

  const rows = useMemo(() => visibleRows(table.rows, role, sort, dir), [table.rows, role, sort, dir]);
  const changed = state.preset === "aichi" ? 0 : table.rows.filter((r) => r.baseTier).length;
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
        MODE_LABEL[mode] + (region !== "all" ? ` · ${REGION_LABEL[region]}` : "") + (sl && bracket !== "all" ? ` · ${BRACKET_LABEL[bracket]}` : ""),
        mapInfo?.ko ?? "전체 전장",
        `패치 ${table.patch}`,
        `${int(table.matches)} 매치`,
        `${shortDate(table.collectedAt)} 갱신`,
      ].join(" · ");

  const sortBy = (key: SortKey) => update(sort === key ? { dir: dir === "desc" ? "asc" : "desc" } : { sort: key, dir: "desc" }, false);

  return (
    <main className="page-x mt-6 space-y-4 pb-10">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-fg">영웅 티어</h1>
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
            <h2 className="text-xl font-extrabold text-fg drop-shadow">{mapInfo.ko}</h2>
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
        <div className="flex w-full flex-wrap gap-1.5 sm:ml-auto sm:w-auto sm:flex-nowrap">
          <label id="region-wrap" className="w-full sm:w-auto sm:flex-none">
            <span className="sr-only">지역</span>
            <select
              id="region"
              value={region}
              disabled={sl && bracket !== "all"}
              title={sl && bracket !== "all" ? COMBO_NOTE : undefined}
              onChange={(e) => update({ region: e.target.value as Region, bracket: "all", patch: "auto" })}
              className={SELECT}
            >
              {REGIONS.map((r) => (
                <option key={r} value={r} disabled={r !== "all" && !regionSample(meta, mode, r)}>
                  {REGION_LABEL[r]}
                  {r !== "all" && !regionSample(meta, mode, r) ? " · 수집 전" : ""}
                </option>
              ))}
            </select>
          </label>
          {sl && (
            <>
            <label id="bracket-wrap" className="flex-1 sm:flex-none">
              <span className="sr-only">리그 구간</span>
              <select id="bracket" value={bracket} disabled={region !== "all"} title={region !== "all" ? COMBO_NOTE : undefined} onChange={(e) => update({ bracket: e.target.value as Bracket })} className={SELECT}>
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
            </>
          )}
          <label id="preset-wrap" className="flex-1 sm:flex-none">
            <span className="sr-only">티어 공식</span>
            <select id="preset" value={state.preset} onChange={(e) => update({ preset: e.target.value as PresetId }, false)} className={SELECT}>
              {(Object.keys(PRESET_LABEL) as PresetId[]).map((p) => (
                <option key={p} value={p}>
                  {PRESET_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {sl && (region !== "all" || bracket !== "all") && (
          <p id="combo-note" className="w-full text-2xs text-muted">
            {COMBO_NOTE}
          </p>
        )}
      </Card>

      {region !== "all" && <RegionNote meta={meta} mode={mode} region={region} />}

      {state.preset !== "aichi" && !busy && (
        <p id="preset-diff" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-fg-2">
          <span>
            <b className="text-fg">{PRESET_LABEL[state.preset]}</b>으로 계산한 티어입니다. 아이치 공식과 티어가 다른 영웅 <b className="num text-fg">{changed}</b>명은{" "}
            <BaseTierChip tier="S" example /> 처럼 원래 티어를 함께 표시합니다.
          </span>
          <button type="button" onClick={() => update({ preset: "aichi" }, false)} className="font-semibold text-secondary hover:text-primary">
            기본 공식으로
          </button>
        </p>
      )}

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
                preset={preset}
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

      <Formula sl={sl} min={meta.min_games_for_tier} preset={preset} />
    </main>
  );
}

const SELECT = "w-full rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg disabled:opacity-50 sm:w-auto";
const COMBO_NOTE = "지역별 데이터는 전체 구간만 수집합니다 — 지역과 리그 구간은 함께 고를 수 없습니다";

/** Which region, when it was collected (regions rotate one a day), and how thin its sample is. */
function RegionNote({ meta, mode, region }: { meta: Meta; mode: Mode; region: Exclude<Region, "all"> }) {
  const s = regionSample(meta, mode, region);
  if (!s) return null;
  return (
    <p
      id="region-note"
      data-thin={s.thin}
      className={cx("num rounded-lg border px-3 py-2 text-[13px]", s.thin ? "border-warn-line bg-warn-bg text-warn-fg" : "border-line bg-surface text-fg-2")}
    >
      {REGION_LABEL[region]} · {s.collectedAt ? `${shortDate(s.collectedAt)} 수집` : "수집일 미상"} · 지역은 하루 한 곳씩 사흘마다 갱신 · {meta.min_games_for_tier}게임 이상 영웅 {s.over}/{s.heroes}
      {s.thin && " — 표본이 적어 티어 없는(회색) 영웅이 많습니다"}
    </p>
  );
}

function HeroRow({ r, cols, n, hasPrevious, sl, preset, span, mode, open, onToggle }: { r: TierRow; cols: SortKey[]; n: number; hasPrevious: boolean; sl: boolean; preset: Preset; span: number; mode: Mode; open: boolean; onToggle: () => void }) {
  const cell: Record<SortKey, string> = {
    score: formatScore(r.score, preset),
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
        data-changed={r.baseTier}
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
        className={cx("cursor-pointer border-b border-line/70 transition-colors hover:bg-surface-2", open && "bg-surface-2", r.baseTier && "shadow-[inset_3px_0_0_var(--color-secondary)]")}
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
              {r.baseTier ? (
                <span className="flex min-w-0 flex-col items-start sm:flex-row sm:items-center">
                  <span data-name className="block truncate font-semibold text-fg">
                    {r.hero.ko}
                  </span>
                  <BaseTierChip tier={r.baseTier} />
                </span>
              ) : (
                <span data-name className="block truncate font-semibold text-fg">
                  {r.hero.ko}
                </span>
              )}
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

/** The hero's tier under 아이치, next to its name when another preset puts it elsewhere. */
function BaseTierChip({ tier, example }: { tier: Tier; example?: boolean }) {
  return (
    <span
      data-base-tier={example ? undefined : tier}
      title={example ? undefined : `아이치 공식으로는 ${tier} 티어`}
      className="inline-block shrink-0 whitespace-nowrap rounded bg-secondary/15 px-1 text-[10px] font-bold leading-4 text-secondary sm:ml-1.5"
    >
      기본 {tier}
    </span>
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
    <div id="patch-banner" className="rounded-lg border border-warn-line bg-warn-bg px-3 py-2.5 text-[13px] text-warn-fg">
      {patch === "previous" ? (
        <>
          패치 {meta.current_patch} 후 {days}일, 표본이 적어 <b>이전 패치({meta.previous_patch})</b> 기준으로 보여줍니다.{" "}
          <button type="button" onClick={onCurrent} className="ml-1 rounded-md bg-warn-strong px-2 py-0.5 font-semibold text-warn-ink">
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

function Formula({ sl, min, preset }: { sl: boolean; min: number; preset: Preset }) {
  return (
    <div className="space-y-2">
      <p id="formula" className="rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs [overflow-wrap:anywhere] text-fg-2">
        {formulaLine(preset, sl)}
        {/* one text node, as before presets: the default page's markup stays byte for byte */}
        {` · 승률은 표본 수축(k=${preset.k}) · `}
        {min}게임 미만 제외 · 상위 6% S / 24% A / 54% B / 82% C / 94% D
      </p>
      <details className="text-[13px]">
        <summary className="cursor-pointer text-secondary">자세히</summary>
        <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-surface p-3 text-xs [overflow-wrap:anywhere] text-fg-2">
          {formulaDetail(preset, sl, min)}
        </pre>
      </details>
    </div>
  );
}
