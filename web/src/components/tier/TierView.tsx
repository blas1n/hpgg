"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { assetUrl, daysSince, hotsHref, loadSnapshot, REGIONS, referencePatch, regionSample, shortDate, snapshotKey, type Bracket, type HeroTable, type MapTable, type Meta, type Mode, type Region } from "@/data";
import { useLocale, useT } from "@/i18n/client";
import type { Locale } from "@/i18n/locale";
import type { Messages } from "@/i18n/messages";
import { formulaDetail, formulaLine, FORMULA, type Party, type Snapshot } from "@/formula";
import { bracketMatches, regionMatches } from "@/lib/shown";
import { DEFAULT_TIER_STATE, formatScore, parseTierState, resolvePatch, tierSearch, tierTable, visibleRows, type SortKey, type TierRow, type TierState, type TierTable } from "@/lib/tier";
import { Card, cx, Portrait, SELECT, Segmented, TierBadge, wrTone } from "../ui";

const pct = (n: number) => `${n.toFixed(1)}%`;
const int = (n: number) => n.toLocaleString("ko-KR");

/** Labels: messages tier.columns. */
const COLUMNS: { key: SortKey; sl?: true; wide?: true }[] = [{ key: "score" }, { key: "win_rate" }, { key: "pick" }, { key: "ban_rate", sl: true }, { key: "games", wide: true }];
// Every column is in the pre-rendered HTML and CSS breakpoints fold the desktop ones: the tier and sample columns open
// from 640px (sm), the role column from 1024px (lg), so the first paint at any width already has the final layout (no
// JS media state). A folded column is kept as an empty zero-width cell rather than display:none, so the table always
// has the same number of columns and a spanning row (tier divider, opened row) spans exactly all of them; with a
// display:none cell the spanning row would add phantom columns that squeeze the hero column.
const WIDE = "max-sm:w-0 max-sm:p-0 max-sm:*:hidden";
const LG = "max-lg:w-0 max-lg:p-0 max-lg:*:hidden";
const BRACKETS: Bracket[] = ["all", "low", "high"];

type Loaded = Record<string, Snapshot | null>; // "latest/qm", "previous/sl_low", … ; null = not published

export interface TierInitial {
  /** The build-time view: Quick Match, all maps, on the patch `resolvePatch` picked at build time. */
  table: TierTable;
  patch: "current" | "previous";
}

export function TierView({ meta, heroes, maps, initial }: { meta: Meta; heroes: HeroTable; maps: MapTable; initial: TierInitial }) {
  const t = useT();
  const locale = useLocale();
  const [state, setState] = useState<TierState>(DEFAULT_TIER_STATE);
  const [loaded, setLoaded] = useState<Loaded>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = parseTierState(location.search);
    setState(s);
    // a link from before a parameter was dropped (e.g. ?preset=, removed 2026-09-29) shows its canonical URL
    const qs = tierSearch(s);
    // (compared as re-encoded params, so %20 vs + alone never rewrites a shared link)
    if (qs !== new URLSearchParams(location.search).toString()) history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : ""));
  }, []);

  const update = (patch: Partial<TierState>) => {
    setState((s) => {
      const next = { ...s, ...patch };
      const qs = tierSearch(next);
      history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : ""));
      return next;
    });
    setError(null);
  };

  const { mode, bracket, region, map, role, sort, dir } = state;
  const sl = mode === "sl";
  const file = snapshotKey(mode, bracket, region);
  // one reference patch for every view; a view with no file on it says so rather than showing another patch
  const { patch, auto } = resolvePatch(meta, state.patch);
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
        const shown = k === curKey; // the file this view shows (the other one only feeds ▲▼)
        try {
          // a region is published only once it has been collected (meta lists it); don't ask for a file that isn't there
          if (region !== "all" && shown && d === "latest" && !meta.modes[f]) {
            setError(t.tier.regionNotCollected(t.common.regions[region]));
            return [k, null] as const;
          }
          const s = await loadSnapshot(f, d === "previous" ? "previous" : "current", heroes);
          if (bracketMatches(s, bracket) && regionMatches(s, region)) return [k, s] as const;
          if (shown) setError(d === "previous" ? t.tier.noPatchData(meta.previous_patch ?? "") : t.tier.cohortMismatch(f, s.league_tier?.join(",") ?? t.tier.all, s.region ?? t.tier.all));
          return [k, null] as const;
        } catch (e) {
          // a view with no file on the patch it shows says so; it never borrows another patch's file
          if (shown) setError(d === "previous" ? t.tier.noPatchData(meta.previous_patch ?? "") : e instanceof Error ? e.message : String(e));
          return [k, null] as const;
        }
      }),
    ).then((pairs) => {
      if (live) setLoaded((l) => ({ ...l, ...Object.fromEntries(pairs) }));
    });
    return () => {
      live = false;
    };
  }, [isInitial, curKey, prevKey, loaded, heroes, bracket, region, meta.modes, t]);

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
  const cols = COLUMNS.filter((c) => !c.sl || sl);
  const span = 4 + cols.length; // every column, folded or not (see WIDE)
  // ranked by score, the rows run tier by tier: a divider row opens each tier (not when sorted by another column)
  const groups = sort === "score";

  // the loading table is the previous view: its patch and match count would be attributed to the new one
  const metaLine = error
    ? t.tier.loadError(error)
    : busy
      ? t.tier.loading
      : [
        t.common.modes[mode] + (region !== "all" ? ` · ${t.common.regions[region]}` : "") + (sl && bracket !== "all" ? ` · ${t.common.brackets[bracket]}` : ""),
        mapInfo?.ko ?? t.common.allMaps,
        t.common.patch(table.patch),
        t.common.matches(int(table.matches)),
        t.common.updated(shortDate(table.collectedAt)),
      ].join(" · ");

  const sortBy = (key: SortKey) => update(sort === key ? { dir: dir === "desc" ? "asc" : "desc" } : { sort: key, dir: "desc" });

  return (
    <main className="page-x mt-6 space-y-4 pb-10">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-fg">{t.tier.title}</h1>
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
            <span className="text-xs text-fg-2">{t.tier.mapBanner(mapInfo.name)}</span>
          </div>
        </div>
      )}

      <PatchBanner meta={meta} mode={mode} patch={patch} auto={auto} onCurrent={() => update({ patch: "current" })} />

      <Card as="div" className="flex flex-wrap items-center gap-2 p-2.5">
        <Segmented
          label={t.common.gameMode}
          idPrefix="mode"
          value={mode}
          onChange={(m: Mode) => m !== mode && update({ mode: m, map: "all", bracket: "all", patch: "auto" })}
          options={[
            { value: "qm", label: t.common.modes.qm },
            { value: "sl", label: t.common.modes.sl },
          ]}
        />
        <div id="roles" role="group" aria-label={t.common.role} className="scrollbar-none flex max-w-full gap-0.5 overflow-x-auto">
          {[{ name: "all", ko: t.common.allRoles }, ...heroes.roles].map((r) => (
            <button
              key={r.name}
              type="button"
              data-role={r.name}
              aria-pressed={role === r.name}
              onClick={() => update({ role: r.name })}
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
            <span className="sr-only">{t.common.region}</span>
            <select
              id="region"
              value={region}
              disabled={sl && bracket !== "all"}
              title={sl && bracket !== "all" ? t.tier.comboNote : undefined}
              onChange={(e) => update({ region: e.target.value as Region, bracket: "all", patch: "auto" })}
              className={SELECT}
            >
              {REGIONS.map((r) => (
                <option key={r} value={r} disabled={r !== "all" && !regionSample(meta, mode, r)}>
                  {t.common.regions[r]}
                  {r !== "all" && !regionSample(meta, mode, r) ? t.tier.notCollected : ""}
                </option>
              ))}
            </select>
          </label>
          {sl && (
            <>
            <label id="bracket-wrap" className="flex-1 sm:flex-none">
              <span className="sr-only">{t.tier.bracket}</span>
              <select id="bracket" value={bracket} disabled={region !== "all"} title={region !== "all" ? t.tier.comboNote : undefined} onChange={(e) => update({ bracket: e.target.value as Bracket })} className={SELECT}>
                {BRACKETS.map((b) => (
                  <option key={b} value={b}>
                    {t.common.brackets[b]}
                  </option>
                ))}
              </select>
            </label>
            <label id="map-wrap" className="flex-1 sm:flex-none">
              <span className="sr-only">{t.common.map}</span>
              <select id="map" value={map} onChange={(e) => update({ map: e.target.value })} className={SELECT}>
                <option value="all">{t.common.allMaps}</option>
                {maps.maps.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.ko}
                  </option>
                ))}
              </select>
            </label>
            </>
          )}
        </div>
        {sl && (region !== "all" || bracket !== "all") && (
          <p id="combo-note" className="w-full text-2xs text-muted">
            {t.tier.comboNote}
          </p>
        )}
      </Card>

      {region !== "all" && <RegionNote meta={meta} mode={mode} region={region} />}

      {/* clip, not hidden: hidden would make the card a scroll container and the sticky column header would stop */}
      <Card as="div" className="overflow-clip">
        <table id="table" aria-busy={busy} className={cx("num w-full table-fixed border-collapse text-[13px] transition-opacity sm:text-sm", busy && "opacity-50")}>
          <thead>
            <tr className="text-xs text-muted [&>th]:sticky [&>th]:top-[var(--header-h)] [&>th]:z-10 [&>th]:bg-surface [&>th]:shadow-[0_1px_0_var(--color-line)]">
              <th data-col="rank" className="w-11 py-2.5 pl-3 text-left font-semibold sm:w-24 sm:pl-4">
                {t.common.rank}
              </th>
              <th data-col="tier" className={cx(WIDE, "w-12 py-2.5 text-center font-semibold")}>
                <span>{t.common.tier}</span>
              </th>
              <th data-col="hero" className="py-2.5 pl-1 text-left font-semibold lg:w-64">
                {t.common.hero}
              </th>
              <th data-col="role" className={cx(LG, "w-28 py-2.5 text-left font-semibold")}>
                <span>{t.common.role}</span>
              </th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  data-col={c.key}
                  data-sort={c.key}
                  aria-sort={sort === c.key ? (dir === "desc" ? "descending" : "ascending") : undefined}
                  className={cx("py-2.5 pr-2 text-right font-semibold sm:pr-4", c.wide && WIDE, c.key === "games" ? "w-24" : c.key === "win_rate" ? "w-14 sm:w-24 lg:w-32" : "w-14 sm:w-24")}
                >
                  <button type="button" onClick={() => sortBy(c.key)} className={cx("whitespace-nowrap transition-colors hover:text-fg", sort === c.key && "text-fg")}>
                    {t.tier.columns[c.key]}
                    {sort === c.key && <span className="text-primary">{dir === "desc" ? " ▾" : " ▴"}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody id="rows">
            {rows.map((r, i) => (
              <Fragment key={r.hero.slug}>
              {groups && r.tier !== rows[i - 1]?.tier && (
                <tr data-tier-group={r.tier} className="bg-surface-2">
                  <td colSpan={span} className="px-3 py-1 text-2xs font-semibold text-muted sm:px-4">
                    <span className="inline-flex items-center gap-1.5">
                      <TierBadge tier={r.tier} size="sm" /> {t.tier.tierGroup(r.tier, String(rows.filter((x) => x.tier === r.tier).length))}
                    </span>
                  </td>
                </tr>
              )}
              <HeroRow
                r={r}
                cols={cols}
                hasPrevious={table.hasPrevious}
                mode={mode}
              />
              </Fragment>
            ))}
          </tbody>
        </table>
      </Card>

      {grey.length > 0 && (
        <section id="grey-wrap">
          <h2 className="mb-2 text-sm font-bold text-muted">
            {t.tier.grey} <span className="text-xs font-normal">{t.tier.greySub(String(meta.min_games_for_tier))}</span>
          </h2>
          <div id="grey" className="flex flex-wrap gap-1.5">
            {grey.map((g) => (
              <span key={g.hero.slug} data-hero={g.hero.slug} className="rounded-md border border-line px-2 py-1 text-xs text-muted">
                {t.tier.greyItem(g.hero.ko, String(g.games))}
              </span>
            ))}
          </div>
        </section>
      )}

      <Formula sl={sl} min={meta.min_games_for_tier} party={table.party} t={t} locale={locale} />
    </main>
  );
}


/** Which region, when it was collected (regions rotate one a day), and how thin its sample is. */
function RegionNote({ meta, mode, region }: { meta: Meta; mode: Mode; region: Exclude<Region, "all"> }) {
  const t = useT();
  const s = regionSample(meta, mode, region);
  if (!s) return null;
  return (
    <p
      id="region-note"
      data-thin={s.thin}
      className={cx("num rounded-lg border px-3 py-2 text-[13px]", s.thin ? "border-warn-line bg-warn-bg text-warn-fg" : "border-line bg-surface text-fg-2")}
    >
      {t.tier.regionNote(
        t.common.regions[region],
        s.collectedAt ? t.tier.collectedOn(shortDate(s.collectedAt)) : t.tier.collectedUnknown,
        String(meta.min_games_for_tier),
        String(s.over),
        String(s.heroes),
      )}
      {s.thin && t.tier.regionThin}
    </p>
  );
}

function HeroRow({ r, cols, hasPrevious, mode }: { r: TierRow; cols: typeof COLUMNS; hasPrevious: boolean; mode: Mode }) {
  const link = hotsHref(useLocale()).hero(r.hero.slug, mode);
  const cell: Record<SortKey, string> = {
    score: formatScore(r.score),
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
        // the whole row goes to the hero page (the table already shows every number; owner 2026-09-29);
        // the hero name is the link keyboards, screen readers and new tabs use
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest("a")) location.assign(link);
        }}
        className="cursor-pointer border-b border-line/70 transition-colors hover:bg-surface-2"
      >
        <td data-col="rank" className="py-1.5 pl-3 sm:pl-4">
          <span className="sm:flex sm:items-center sm:gap-2">
            <span data-v className="block font-bold text-fg">
              {r.rank}
            </span>
            {hasPrevious && <Delta rank={r.rank} prev={r.prevRank} />}
          </span>
        </td>
        <td data-col="tier" className={cx(WIDE, "py-1.5 text-center")}>
          <TierBadge tier={r.tier} />
        </td>
        <td data-col="hero" className="overflow-hidden py-1.5 pl-1">
          <span className="flex min-w-0 items-center gap-2.5">
            {/* the tier has its own column from 640px; on a phone it stays on the portrait */}
            <Portrait src={r.hero.portrait} size={34} tier={r.tier} tierClassName="sm:hidden" className="sm:size-7!" role={r.hero.role || undefined} />
            <span className="min-w-0 sm:flex sm:items-baseline sm:gap-1.5">
              <a data-link href={link} className="block max-w-full truncate font-semibold text-fg focus-visible:outline-2 focus-visible:outline-primary">
                <span data-name>{r.hero.ko}</span>
              </a>
              <span className="hidden truncate text-2xs text-muted sm:block">
                {/* the API name, where it differs from the name shown (on English pages it is the same) */}
                {r.hero.name !== r.hero.ko && r.hero.name}
                {/* the role has its own column from 1024px */}
                {r.hero.role_ko && <span className="lg:hidden">{(r.hero.name !== r.hero.ko ? " · " : "") + r.hero.role_ko}</span>}
              </span>
            </span>
          </span>
        </td>
        <td data-col="role" className={cx(LG, "truncate py-1.5 text-[13px] text-fg-2")}>
          <span>{r.hero.role_ko}</span>
        </td>
        {cols.map(({ key: k, wide }) => (
          <td key={k} data-col={k} className={cx("py-1.5 pr-2 text-right sm:pr-4", wide && WIDE, k === "score" ? (r.score < 0 ? "font-bold text-neg" : "font-bold text-fg") : "text-fg-2", k === "win_rate" && wrTone(r.win_rate))}>
            <span data-v>{cell[k]}</span>
            {k === "win_rate" && <span className="ml-1 hidden text-2xs text-muted lg:inline">±{r.wrHalf.toFixed(1)}</span>}
          </td>
        ))}
      </tr>
    </Fragment>
  );
}

/** ▲3 / ▼2 / — 0 / NEW against the previous patch (NEW = unranked there). */
function Delta({ rank, prev }: { rank: number; prev: number | null }) {
  const t = useT();
  const d = prev === null ? null : prev - rank;
  const [text, tone] = d === null ? ["NEW", "bg-primary/15 text-primary"] : d === 0 ? ["— 0", "bg-surface-3 text-muted"] : d > 0 ? [`▲ ${d}`, "bg-pos/15 text-pos"] : [`▼ ${-d}`, "bg-neg/15 text-neg"];
  return (
    <span data-delta={d ?? "new"} title={prev === null ? t.tier.deltaNewTitle : t.tier.deltaTitle(String(prev))} className={cx("mt-0.5 inline-block whitespace-nowrap rounded-full px-1.5 text-2xs font-bold sm:mt-0", tone)}>
      {text}
    </span>
  );
}

function PatchBanner({ meta, mode, patch, auto, onCurrent }: { meta: Meta; mode: Mode; patch: "current" | "previous"; auto: boolean; onCurrent: () => void }) {
  const t = useT();
  const days = daysSince(meta.patch_started_at);
  const note = patch === "previous" || (!auto && referencePatch(meta) === "previous");
  if (!note) return null;
  return (
    <div id="patch-banner" className="rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-[13px] text-warn-fg">
      {patch === "previous" ? (
        <>
          {t.tier.bannerPrevious(meta.current_patch, String(days))}
          <b>{t.tier.bannerPreviousPatch(meta.previous_patch ?? "")}</b>
          {t.tier.bannerPreviousEnd}{" "}
          <button type="button" onClick={onCurrent} className="ml-1 rounded-md bg-warn-strong px-2 py-0.5 font-semibold text-warn-ink">
            {t.tier.bannerShowCurrent}
          </button>
        </>
      ) : (
        <>{t.tier.bannerThin(meta.current_patch, String(days))}</>
      )}
    </div>
  );
}

function Formula({ sl, min, party, t, locale }: { sl: boolean; min: number; party: Party | null; t: Messages; locale: Locale }) {
  return (
    <div className="space-y-2">
      {/* one readable line length (#30); Korean breaks only between words */}
      <p id="formula" className="max-w-[80ch] rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs break-keep [overflow-wrap:anywhere] text-fg-2">
        {formulaLine(sl, locale)}
        {t.tier.formulaTail(String(FORMULA.k), party ? t.tier.formulaParty(String(party.k)) : "")}
        {t.tier.formulaCuts(String(min))}
      </p>
      <details className="text-[13px]">
        <summary className="cursor-pointer text-secondary">{t.tier.details}</summary>
        <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-surface p-3 text-xs break-keep [overflow-wrap:anywhere] text-fg-2">
          {formulaDetail(sl, min, locale, party)}
        </pre>
      </details>
    </div>
  );
}
