"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { assetUrl, hotsHref, shortDate, type HeroInfo, type Mode } from "@/data";
import { useLocale, useT } from "@/i18n/client";
import { descParts, type BracketRow, type BuildTalentView, type BuildView, type HeroSummary, type MapRow, type RegionRow } from "@/lib/hero";
import { matchupRule, type MatchupRow, type MatchupsView } from "@/lib/matchups";
import type { HeroPatchNotes, PatchNoteView } from "@/lib/patchnotes";
import { Card, cx, Portrait, Segmented, TierBadge, wrTone } from "../ui";

const pct = (n: number) => `${n.toFixed(1)}%`;
const int = (n: number) => n.toLocaleString("ko-KR");

export interface HeroModeModel {
  patch: string;
  collectedAt: string;
  /** The thin current patch when this model is the previous one (lib/shown.ts). */
  fallbackFrom: string | null;
  summary: HeroSummary;
  maps: MapRow[];
  brackets: BracketRow[]; // Storm League only
  /** Collected regions for this mode (each with its own date: regions rotate one a day). */
  regions: RegionRow[];
}

// section titles land just below the header + sticky tabs
const SECTION = "scroll-mt-[calc(var(--header-h)+48px)] mb-2.5 mt-6 text-base font-extrabold text-fg";

export function HeroView({
  hero,
  models,
  builds,
  buildsPatch,
  matchups,
  patches,
  minGames,
}: {
  hero: HeroInfo;
  models: Record<Mode, HeroModeModel>;
  builds: BuildView[];
  buildsPatch: string | null;
  /** Storm League counters/synergies; null until the first matchups collection. */
  matchups: MatchupsView | null;
  /** This hero in Blizzard's official patch notes (#62); the same in both modes. */
  patches: HeroPatchNotes;
  minGames: number;
}) {
  const t = useT();
  const [mode, setMode] = useState<Mode>("qm");
  useEffect(() => {
    if (new URLSearchParams(location.search).get("mode") !== "sl") return;
    setMode("sl");
    // a shared …?mode=sl#builds-title link: the Storm League sections above the target appear after the browser jumped
    const id = location.hash.slice(1);
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "instant" }));
  }, []);
  const change = (m: Mode) => {
    setMode(m);
    history.replaceState(null, "", location.pathname + (m === "sl" ? "?mode=sl" : "") + location.hash);
  };
  const m = models[mode];
  const s = m.summary;
  const sl = mode === "sl";

  const tab = t.hero.sections;
  const sections = [
    { id: "top", label: tab.top },
    { id: "maps-title", label: tab.maps },
    ...(sl && m.brackets.length ? [{ id: "brackets-title", label: tab.brackets, nav: "nav-brackets" }] : []),
    ...(m.regions.length ? [{ id: "regions-title", label: tab.regions, nav: "nav-regions" }] : []),
    ...(matchups ? [{ id: "matchups-title", label: tab.matchups, nav: "nav-matchups" }] : []),
    ...(builds.length ? [{ id: "builds-title", label: tab.builds, nav: "nav-builds" }] : []),
    // long and not what people come for first: last, below both columns
    ...(patches.notes.length || patches.since ? [{ id: "patches-title", label: tab.patches, nav: "nav-patches" }] : []),
  ];

  return (
    <main className="page-x pb-10">
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,36rem)] lg:items-center lg:gap-x-8">
      <div className="mt-1 flex items-center gap-4">
        <Portrait src={hero.portrait} size={84} tier={s.kind === "ranked" ? s.tier : undefined} role={hero.role} />
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-fg">{hero.ko}</h1>
          <p className="text-xs text-fg-2">
            {/* the API name, where it differs from the name shown (on English pages it is the same) */}
            {[hero.name !== hero.ko && hero.name, hero.role_ko].filter(Boolean).join(" · ")}
          </p>
          <p id="meta-line" className="num mt-0.5 text-xs text-muted">
            {t.common.modes[mode]} · {t.common.patch(m.patch)} · {t.common.updated(shortDate(m.collectedAt))}
            {m.fallbackFrom && <span data-fallback> · {t.common.fallbackNote(m.fallbackFrom)}</span>}
          </p>
        </div>
      </div>

      <div className="mt-4">
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
      </div>

      <div id="stats" className="mt-4 grid grid-cols-3 gap-2 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-5">
        <StatCards s={s} sl={sl} minGames={minGames} />
      </div>
      </div>

      <SectionTabs sections={sections} />

      {/* desktop: maps on the left, the other sections on the right, so the page is not one long column */}
      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-6">
      <section>
      <h2 id="maps-title" className={SECTION}>
        {t.hero.mapsTitle(t.common.modes[mode])}
      </h2>
      <div id="maps">
        <MapRows rows={m.maps} />
      </div>
      </section>
      <section>

      {sl && m.brackets.length > 0 && (
        <>
          <h2 id="brackets-title" className={SECTION}>
            {t.hero.bracketsTitle}
          </h2>
          <div id="brackets" className="flex flex-col gap-1.5">
            {m.brackets.map((b) => (
              <div key={b.key} data-bracket={b.key} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
                {b.tier ? <TierBadge tier={b.tier} size="lg" /> : <span className="text-center text-muted">–</span>}
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-fg">{t.common.brackets[b.key]}</span>
                  <span className="num block text-2xs text-muted">
                    {b.rank ? `#${b.rank} / ${b.n}` : t.common.thin} · {t.common.games(int(b.games))}
                  </span>
                </span>
                <span className="num text-right">
                  <span className={cx("block text-[13px] font-bold", wrTone(b.win_rate))}>{pct(b.win_rate)}</span>
                  <span className="block text-2xs text-muted">{t.hero.pickBan(pct(b.pick), pct(b.ban_rate))}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {m.regions.length > 0 && (
        <>
          <h2 id="regions-title" className={SECTION}>
            {t.hero.regionsTitle(t.common.modes[mode])} <span className="text-xs font-normal text-muted">{t.hero.regionsSub}</span>
          </h2>
          <div id="regions" className="flex flex-col gap-1.5">
            {m.regions.map((r) => (
              <div key={r.key} data-region={r.key} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
                {r.tier ? <TierBadge tier={r.tier} size="lg" /> : <span className="text-center text-muted">–</span>}
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-fg">{t.common.regions[r.key]}</span>
                  <span className="num block text-2xs text-muted">
                    {r.rank ? `#${r.rank} / ${r.n}` : t.common.thin} · {t.common.games(int(r.games))} · {t.common.collected(shortDate(r.collectedAt))}
                  </span>
                </span>
                <span className="num text-right">
                  <span className={cx("block text-[13px] font-bold", wrTone(r.win_rate))}>{pct(r.win_rate)}</span>
                  <span className="block text-2xs text-muted">{t.hero.pickShort(pct(r.pick))}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <Matchups hero={hero} v={matchups} />

      {builds.length > 0 && (
        <>
          <h2 id="builds-title" className={SECTION}>
            {t.hero.buildsTitle}{" "}
            <span id="builds-sub" className="text-xs font-normal text-muted">
              {t.hero.buildsSub(buildsPatch ?? "")}
            </span>
          </h2>
          <Builds builds={builds} />
        </>
      )}
      </section>
      </div>
      <Patches p={patches} />
    </main>
  );
}

function SectionTabs({ sections }: { sections: { id: string; label: string; nav?: string }[] }) {
  const t = useT();
  const nav = useRef<HTMLElement>(null);
  const [active, setActive] = useState("top");
  const ids = sections.map((x) => x.id).join(",");
  useEffect(() => {
    // the tab of the last section whose title has passed under the tabs
    const update = () => {
      const line = (nav.current?.getBoundingClientRect().bottom ?? 0) + 16;
      let current = "top";
      for (const id of ids.split(",")) {
        const el = id === "top" ? null : document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      // at the bottom of the page the last title may never reach the tabs: it is still the section in view
      const last = ids.split(",").at(-1)!;
      if (last !== "top" && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) current = last;
      setActive(current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [ids]);
  return (
    <nav ref={nav} aria-label={t.hero.sectionNav} data-subnav className="scrollbar-none sticky top-[var(--header-h)] z-30 -mx-4 mb-3 mt-2 flex gap-0.5 overflow-x-auto border-b border-line bg-bg/95 px-4 backdrop-blur sm:mx-0 sm:px-0">
      {sections.map((x) => (
        <a
          key={x.id}
          id={x.nav}
          href={`#${x.id}`}
          aria-current={active === x.id ? "location" : undefined}
          className={cx("whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-semibold transition-colors", active === x.id ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg")}
        >
          {x.label}
        </a>
      ))}
    </nav>
  );
}

function StatCards({ s, sl, minGames }: { s: HeroSummary; sl: boolean; minGames: number }) {
  const t = useT();
  if (s.kind === "none") return <Stat k={t.hero.noData} v="–" sub={t.hero.noDataSub} />;
  if (s.kind === "grey")
    return (
      <>
        <Stat id="tier" k={t.common.tier} v="–" sub={t.hero.thinTier(int(s.games), String(minGames))} />
        <Stat id="wr" k={t.common.winRate} v={pct(s.win_rate)} sub={t.common.games(int(s.games))} />
        <Stat id="pick" k={t.common.pickRate} v={pct(s.pick)} sub="" />
      </>
    );
  // same wording as the tier table: ▲ 3 / ▼ 2 / — 0
  const d = s.delta;
  const [text, tone] = d === null ? [s.hasPrevious ? t.hero.prevThin : "", "text-muted"] : d === 0 ? ["— 0", "text-muted"] : d > 0 ? [`▲ ${d}`, "text-pos"] : [`▼ ${-d}`, "text-neg"];
  return (
    <>
      <Stat
        id="tier"
        k={t.common.tier}
        v={
          <span className="inline-flex items-center gap-1.5">
            <TierBadge tier={s.tier} size="lg" /> #{s.rank}
          </span>
        }
        sub={text}
        subTone={tone}
        delta={d === null ? "none" : String(d)}
        title={s.prevRank ? t.hero.prevRank(String(s.prevRank)) : undefined}
      />
      <Stat id="wr" k={t.common.winRate} v={pct(s.win_rate)} sub={t.common.games(int(s.games))} />
      <Stat id="pick" k={t.common.pickRate} v={pct(s.pick)} sub={sl ? t.hero.banSub(pct(s.ban_rate)) : ""} />
    </>
  );
}

function Stat({ id, k, v, sub, subTone = "text-muted", delta, title }: { id?: string; k: string; v: React.ReactNode; sub: string; subTone?: string; delta?: string; title?: string }) {
  return (
    <Card as="div" className="min-w-0 px-3 py-2.5" data-stat={id}>
      <div className="text-2xs text-muted">{k}</div>
      <div className="num my-0.5 text-[19px] font-extrabold text-fg sm:text-[22px]">{v}</div>
      <div data-sub data-delta={delta} title={title} className={cx("num truncate text-2xs sm:text-xs", subTone)}>
        {sub || " "}
      </div>
    </Card>
  );
}

function MapRows({ rows }: { rows: MapRow[] }) {
  const t = useT();
  if (!rows.length) return <p className="rounded-lg border border-line bg-surface px-3 py-4 text-center text-[13px] text-muted">{t.hero.noMaps}</p>;
  // bar length = distance from 50%, scaled to this hero's widest gap (at least 5%p)
  const span = Math.max(5, ...rows.map((r) => Math.abs(r.win_rate - 50)));
  return (
    <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
      {rows.map((r) => {
    const up = r.win_rate >= 50;
    // not a link: the per-map tier table is a different view (owner, 2026-09-28)
    return (
      <div key={r.slug} data-map={r.slug} className="grid grid-cols-[44px_1fr_auto] items-center gap-3 px-2.5 py-1">
        {r.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={assetUrl(r.image)} alt="" loading="lazy" className="h-[26px] w-11 rounded object-cover" />
        ) : (
          <span className="h-[26px] w-11 rounded bg-surface-3" />
        )}
        <span className="min-w-0">
          <span className="text-[13px] font-semibold text-fg">{r.ko}</span>{" "}
          <span className="num text-2xs text-muted">
            {t.common.games(int(r.games))}
            {r.thin && ` · ${t.common.thin}`}
          </span>
          <span className="mt-1 block h-[3px] overflow-hidden rounded-full bg-surface-3">
            <i className={cx("block h-full rounded-full", up ? "bg-pos" : "bg-neg")} style={{ width: `${Math.min(100, (Math.abs(r.win_rate - 50) / span) * 100)}%` }} />
          </span>
        </span>
        <span className="num text-right">
          <span className={cx("block text-[13px] font-semibold leading-4", wrTone(r.win_rate))}>{pct(r.win_rate)}</span>
          <span className="block text-2xs leading-4 text-muted">{t.hero.pickShort(pct(r.pick))}</span>
        </span>
      </div>
    );
      })}
    </div>
  );
}

const VERDICT_TONE = {
  buff: "border-pos/40 text-pos",
  nerf: "border-neg/40 text-neg",
  mixed: "border-warn-line bg-warn-bg text-warn-fg",
} as const;

function Patches({ p }: { p: HeroPatchNotes }) {
  const t = useT();
  if (!p.notes.length && !p.since) return null;
  return (
    <>
      <h2 id="patches-title" className={SECTION}>
        {t.hero.patchesTitle} <span className="text-xs font-normal text-muted">{t.hero.patchesSub}</span>
      </h2>
      <div id="patches" className="flex flex-col gap-2">
        {p.notes.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface px-3 py-4 text-center text-[13px] text-muted">{t.hero.noPatches(p.since!.slice(0, 7))}</p>
        ) : (
          <>
            {p.notes.map((n) => (
              <PatchNote key={n.id} n={n} />
            ))}
            <p id="patches-rule" className="text-2xs leading-relaxed text-muted">
              {t.hero.patchesRule}
            </p>
          </>
        )}
      </div>
    </>
  );
}

function PatchNote({ n }: { n: PatchNoteView }) {
  const t = useT();
  return (
    <article data-note={n.id} data-kind={n.kind} className="rounded-card border border-line bg-surface px-3 py-2.5">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span data-verdict={n.verdict ?? "hotfix"} className={cx("rounded border px-1.5 py-px text-2xs font-bold", n.verdict ? VERDICT_TONE[n.verdict] : "border-line text-fg-2")}>
          {n.verdict ? t.hero.patchVerdict[n.verdict] : t.hero.hotfixBadge}
        </span>
        {n.url ? (
          <a href={n.url} target="_blank" rel="noopener noreferrer" className="min-w-0 text-[13px] font-semibold text-fg hover:underline">
            {n.title}
          </a>
        ) : (
          <span className="min-w-0 text-[13px] font-semibold text-fg">{t.hero.hotfixTitle(n.title)}</span>
        )}
        {n.status && (
          <span data-status={n.status} className="text-2xs text-muted">
            {t.hero.patchStatus[n.status]}
          </span>
        )}
      </header>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {n.groups.map((g, i) => (
          <div key={i}>
            <div className="text-2xs text-muted">
              {[t.hero.patchSection[g.section], g.level !== null && t.hero.patchLevel(String(g.level)), g.ability].filter(Boolean).join(" · ")}
            </div>
            <ul className="mt-0.5 flex flex-col gap-0.5">
              {g.changes.map((c, j) => (
                <li key={j} data-change={c.direction} className="grid grid-cols-[14px_1fr] gap-1 text-[13px] leading-snug text-fg-2">
                  <span aria-hidden className={cx("text-center text-2xs leading-5", c.direction === "up" ? "text-pos" : c.direction === "down" ? "text-neg" : "text-muted")}>
                    {c.direction === "up" ? "▲" : c.direction === "down" ? "▼" : "·"}
                  </span>
                  <span>{c.text}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </article>
  );
}

/** 상성 — Storm League only (the draft mode), whatever the mode toggle says; numbers only, no per-pair prose. */
function Matchups({ hero, v }: { hero: HeroInfo; v: MatchupsView | null }) {
  const t = useT();
  const locale = useLocale();
  return (
    <>
      <h2 id="matchups-title" className={SECTION}>
        {t.hero.matchupsTitle(t.common.modes.sl)}{" "}
        {v && (
          <span id="matchups-sub" className="num text-xs font-normal text-muted">
            {t.hero.matchupsSub(v.patch, shortDate(v.collectedAt), hero.ko, pct(v.win_rate), int(v.games))}
          </span>
        )}
      </h2>
      <div id="matchups">
        {!v ? (
          <p className="rounded-lg border border-line bg-surface px-3 py-4 text-center text-[13px] text-muted">{t.hero.matchupsLater}</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <MatchupList id="counters" title={t.hero.counters} note={t.hero.countersNote} rows={v.counters} />
              <MatchupList id="synergies" title={t.hero.synergies} note={t.hero.synergiesNote} rows={v.synergies} />
            </div>
            <p id="matchups-rule" className="num mt-2 text-2xs leading-relaxed text-muted">
              {t.hero.matchupsRule(hero.ko, matchupRule(locale))}
            </p>
          </>
        )}
      </div>
    </>
  );
}

function MatchupList({ id, title, note, rows }: { id: string; title: string; note: string; rows: MatchupRow[] }) {
  const t = useT();
  const href = hotsHref(useLocale());
  return (
    <section aria-labelledby={`${id}-title`}>
      <h3 className="mb-1.5 flex items-baseline justify-between gap-2">
        <span id={`${id}-title`} className="text-[13px] font-bold text-fg">
          {title}
        </span>
        <span className="text-2xs text-muted">{note}</span>
      </h3>
      <div id={id} className="flex flex-col gap-1.5">
        {rows.length === 0 && <p className="rounded-lg border border-line bg-surface px-3 py-3 text-center text-[13px] text-muted">{t.hero.noMatchups}</p>}
        {rows.map((r) => {
          const up = r.delta >= 0;
          const body = (
            <>
              <Portrait src={r.portrait} size={32} />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-fg">{r.ko}</span>
                <span className="num block text-2xs text-muted">
                  {t.hero.matchupLine(int(r.games), pct(r.win_rate))}
                </span>
              </span>
              <span data-delta className={cx("num text-right text-[13px] font-bold", up ? "text-pos" : "text-neg")}>
                {up ? "+" : ""}
                {r.delta.toFixed(1)}%p
              </span>
            </>
          );
          const cls = "grid grid-cols-[32px_1fr_auto] items-center gap-3 rounded-lg border border-line bg-surface px-2.5 py-1.5";
          return r.slug ? (
            <a key={r.hero} data-matchup={r.slug} href={href.hero(r.slug)} className={cx(cls, "hover:border-line-strong")}>
              {body}
            </a>
          ) : (
            <div key={r.hero} data-matchup={r.hero} className={cls}>
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}

type Pop = { t: BuildTalentView; left: number; top: number; width: number; anchor: DOMRect };

function Builds({ builds }: { builds: BuildView[] }) {
  const t = useT();
  const locale = useLocale();
  const [pop, setPop] = useState<Pop | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pop) return;
    const close = () => setPop(null);
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("click", close);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", close);
    };
  }, [pop]);

  // lol.ps-style: under the tapped icon, kept on screen; above it when there is no room below
  useEffect(() => {
    const el = box.current;
    if (!pop || !el) return;
    const margin = 12;
    const h = el.offsetHeight;
    const a = pop.anchor;
    const above = a.bottom + 8 + h > window.innerHeight - margin && a.top - 8 - h > margin;
    el.style.top = `${(above ? a.top - 8 - h : a.bottom + 8) + window.scrollY}px`;
  }, [pop]);

  const open = (e: React.MouseEvent<HTMLButtonElement>, t: BuildTalentView) => {
    e.stopPropagation();
    const a = e.currentTarget.getBoundingClientRect();
    const margin = 12;
    const width = Math.min(320, window.innerWidth - margin * 2);
    const left = Math.min(Math.max(a.left + a.width / 2 - width / 2, margin), window.innerWidth - width - margin) + window.scrollX;
    setPop({ t, left, top: a.bottom + 8 + window.scrollY, width, anchor: a });
  };

  return (
    <div id="builds" className="grid gap-2">
      {builds.map((b, i) => (
        <Card as="div" key={i} data-build={i + 1} data-thin={b.thin || undefined} className="grid grid-cols-[1fr_76px] gap-2 p-2">
          <div className="grid grid-cols-7 gap-1">
            {b.talents.map((tl) => (
              <button
                key={tl.level}
                type="button"
                data-talent
                aria-label={t.hero.talentAria(String(tl.level), tl.ko)}
                onClick={(e) => open(e, tl)}
                className="group flex min-w-0 flex-col items-center gap-0.5"
              >
                {tl.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={assetUrl(`img/talents/${tl.icon}`)} alt="" loading="lazy" className="size-9 rounded-md border border-line bg-surface-3 group-hover:border-primary sm:size-11" />
                ) : (
                  <span className="size-9 rounded-md border border-line bg-surface-3 sm:size-11" />
                )}
                <span data-level className="text-2xs text-muted">
                  {tl.level}
                </span>
                <span data-tname className="line-clamp-2 w-full hyphens-auto text-center text-2xs leading-tight text-fg-2 [overflow-wrap:anywhere]">
                  {tl.ko}
                </span>
              </button>
            ))}
          </div>
          <div className="num flex flex-col justify-center text-right">
            {/* a thin build's win rate is shown, but not as a finding */}
            <span data-wr title={b.thin ? t.hero.thinBuild : undefined} className={cx("text-lg", b.thin ? "font-semibold text-muted" : cx("font-extrabold", wrTone(b.win_rate)))}>
              {pct(b.win_rate)}
            </span>
            <span className="text-2xs text-muted">{b.thin ? t.hero.buildWinRateThin : t.hero.buildWinRate}</span>
            <span className="text-[13px] text-fg">{int(b.games)}</span>
            <span className="text-2xs text-muted">{t.hero.buildGames}</span>
            <span className="mt-1 block h-[3px] rounded-full bg-surface-3">
              <i className="block h-full rounded-full bg-accent" style={{ width: `${b.share * 100}%` }} />
            </span>
          </div>
        </Card>
      ))}
      {pop &&
        createPortal(
        <div
          ref={box}
          id="talent-pop"
          role="dialog"
          aria-label={t.hero.talentDialog(pop.t.ko)}
          onClick={(e) => e.stopPropagation()}
          style={{ left: pop.left, top: pop.top, width: pop.width }}
          className="absolute z-60 rounded-xl border border-line-strong bg-pop px-3.5 py-3 shadow-[0_16px_40px_rgba(0,0,0,0.55)]"
        >
          <div className="flex items-center gap-2.5">
            {pop.t.icon && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={assetUrl(`img/talents/${pop.t.icon}`)} alt="" className="size-9 rounded-md border border-line" />
            )}
            <div>
              <div data-pop-name className="text-sm font-extrabold text-fg">
                {pop.t.ko}
              </div>
              <div data-pop-level className="text-2xs text-muted">
                {t.hero.level(String(pop.t.level))}
                {pop.t.cd ? ` · ${pop.t.cd.replace(/\{\{|\}\}/g, "")}` : ""}
              </div>
            </div>
          </div>
          <p data-pop-desc className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-pop-fg">
            {descParts(pop.t.desc, locale).map((p, i) =>
              p.hl ? (
                <span key={i} data-hl className="font-bold text-accent">
                  {p.text}
                </span>
              ) : (
                p.text
              ),
            )}
          </p>
        </div>,
          document.body, // document coordinates: no positioned ancestor may move it
        )}
    </div>
  );
}
