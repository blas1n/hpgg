"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { assetUrl, fallbackNote, MODE_LABEL, shortDate, type HeroInfo, type Mode } from "@/data";
import { descParts, type BracketRow, type BuildTalentView, type BuildView, type HeroSummary, type MapRow } from "@/lib/hero";
import { Card, cx, Portrait, Segmented, TierBadge } from "../ui";

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
}

// section titles land just below the header + sticky tabs
const SECTION = "scroll-mt-[calc(var(--header-h)+48px)] mb-2.5 mt-6 text-base font-extrabold text-fg";

export function HeroView({ hero, models, builds, buildsPatch, minGames }: { hero: HeroInfo; models: Record<Mode, HeroModeModel>; builds: BuildView[]; buildsPatch: string | null; minGames: number }) {
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

  const sections = [
    { id: "top", label: "요약" },
    { id: "maps-title", label: "전장" },
    ...(sl && m.brackets.length ? [{ id: "brackets-title", label: "구간", nav: "nav-brackets" }] : []),
    ...(builds.length ? [{ id: "builds-title", label: "특성 빌드", nav: "nav-builds" }] : []),
  ];

  return (
    <main className="page-x pb-10">
      <div className="mt-5 flex items-center gap-4">
        <Portrait src={hero.portrait} size={84} tier={s.kind === "ranked" ? s.tier : undefined} role={hero.role} />
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-white">{hero.ko}</h1>
          <p className="text-xs text-fg-2">
            {hero.name} · {hero.role_ko}
          </p>
          <p id="meta-line" className="num mt-0.5 text-xs text-muted">
            {MODE_LABEL[mode]} · 패치 {m.patch} · {shortDate(m.collectedAt)} 갱신
            {m.fallbackFrom && <span data-fallback> · {fallbackNote(m.fallbackFrom)}</span>}
          </p>
        </div>
      </div>

      <div className="mt-4">
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

      <SectionTabs sections={sections} />

      <div id="stats" className="grid grid-cols-3 gap-2">
        <StatCards s={s} sl={sl} minGames={minGames} />
      </div>

      <h2 id="maps-title" className={SECTION}>
        전장별 승률 ({MODE_LABEL[mode]})
      </h2>
      <div id="maps" className="flex flex-col gap-1.5">
        <MapRows rows={m.maps} />
      </div>

      {sl && m.brackets.length > 0 && (
        <>
          <h2 id="brackets-title" className={SECTION}>
            리그 구간별
          </h2>
          <div id="brackets" className="flex flex-col gap-1.5">
            {m.brackets.map((b) => (
              <div key={b.key} data-bracket={b.key} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
                {b.tier ? <TierBadge tier={b.tier} size="lg" /> : <span className="text-center text-muted">–</span>}
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-fg">{b.label}</span>
                  <span className="num block text-2xs text-muted">
                    {b.rank ? `#${b.rank} / ${b.n}` : "표본 부족"} · {int(b.games)}게임
                  </span>
                </span>
                <span className="num text-right">
                  <span className={cx("block text-[13px] font-bold", b.win_rate >= 50 ? "text-pos" : "text-neg")}>{pct(b.win_rate)}</span>
                  <span className="block text-2xs text-muted">
                    픽 {pct(b.pick)} · 밴 {pct(b.ban_rate)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {builds.length > 0 && (
        <>
          <h2 id="builds-title" className={SECTION}>
            인기 특성 빌드{" "}
            <span id="builds-sub" className="text-xs font-normal text-muted">
              빠른 대전 + 폭풍 리그 합산 · 패치 {buildsPatch} · 많이 쓴 순
            </span>
          </h2>
          <Builds builds={builds} />
        </>
      )}
    </main>
  );
}

function SectionTabs({ sections }: { sections: { id: string; label: string; nav?: string }[] }) {
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
    <nav ref={nav} aria-label="섹션" data-subnav className="scrollbar-none sticky top-[var(--header-h)] z-30 -mx-4 mb-3 mt-2 flex gap-0.5 overflow-x-auto border-b border-line bg-bg/95 px-4 backdrop-blur sm:mx-0 sm:px-0">
      {sections.map((x) => (
        <a
          key={x.id}
          id={x.nav}
          href={`#${x.id}`}
          aria-current={active === x.id ? "location" : undefined}
          className={cx("whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-semibold transition-colors", active === x.id ? "border-fg text-white" : "border-transparent text-muted hover:text-fg")}
        >
          {x.label}
        </a>
      ))}
    </nav>
  );
}

function StatCards({ s, sl, minGames }: { s: HeroSummary; sl: boolean; minGames: number }) {
  if (s.kind === "none") return <Stat k="데이터 없음" v="–" sub="이 모드에 표본이 없습니다" />;
  if (s.kind === "grey")
    return (
      <>
        <Stat id="tier" k="티어" v="–" sub={`표본 부족 (${int(s.games)}게임 < ${minGames})`} />
        <Stat id="wr" k="승률" v={pct(s.win_rate)} sub={`${int(s.games)}게임`} />
        <Stat id="pick" k="픽률" v={pct(s.pick)} sub="" />
      </>
    );
  // same wording as the tier table: ▲ 3 / ▼ 2 / — 0
  const d = s.delta;
  const [text, tone] = d === null ? [s.hasPrevious ? "직전 표본 부족" : "", "text-muted"] : d === 0 ? ["— 0", "text-muted"] : d > 0 ? [`▲ ${d}`, "text-pos"] : [`▼ ${-d}`, "text-neg"];
  return (
    <>
      <Stat
        id="tier"
        k="티어"
        v={
          <span className="inline-flex items-center gap-1.5">
            <TierBadge tier={s.tier} size="lg" /> #{s.rank}
          </span>
        }
        sub={text}
        subTone={tone}
        delta={d === null ? "none" : String(d)}
        title={s.prevRank ? `직전 패치 #${s.prevRank}` : undefined}
      />
      <Stat id="wr" k="승률" v={pct(s.win_rate)} sub={`${int(s.games)}게임`} />
      <Stat id="pick" k="픽률" v={pct(s.pick)} sub={sl ? `밴률 ${pct(s.ban_rate)}` : ""} />
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
  if (!rows.length) return <p className="rounded-lg border border-line bg-surface px-3 py-4 text-center text-[13px] text-muted">이 모드엔 전장별 표본이 없습니다</p>;
  // bar length = distance from 50%, scaled to this hero's widest gap (at least 5%p)
  const span = Math.max(5, ...rows.map((r) => Math.abs(r.win_rate - 50)));
  return rows.map((r) => {
    const up = r.win_rate >= 50;
    // not a link: the per-map tier table is a different view (owner, 2026-09-28)
    return (
      <div key={r.slug} data-map={r.slug} className="grid grid-cols-[44px_1fr_auto] items-center gap-3 rounded-lg border border-line bg-surface px-2.5 py-1.5">
        {r.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={assetUrl(r.image)} alt="" loading="lazy" className="h-[26px] w-11 rounded object-cover" />
        ) : (
          <span className="h-[26px] w-11 rounded bg-surface-3" />
        )}
        <span className="min-w-0">
          <span className="text-[13px] font-semibold text-fg">{r.ko}</span>{" "}
          <span className="num text-2xs text-muted">
            {int(r.games)}게임{r.thin && " · 표본 부족"}
          </span>
          <span className="mt-1 block h-[3px] overflow-hidden rounded-full bg-surface-3">
            <i className={cx("block h-full rounded-full", up ? "bg-pos" : "bg-neg")} style={{ width: `${Math.min(100, (Math.abs(r.win_rate - 50) / span) * 100)}%` }} />
          </span>
        </span>
        <span className="num text-right">
          <span className={cx("block text-[13px] font-semibold", up ? "text-pos" : "text-neg")}>{pct(r.win_rate)}</span>
          <span className="block text-2xs text-muted">픽 {pct(r.pick)}</span>
        </span>
      </div>
    );
  });
}

type Pop = { t: BuildTalentView; left: number; top: number; width: number; anchor: DOMRect };

function Builds({ builds }: { builds: BuildView[] }) {
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
    <div id="builds" className="grid gap-2 lg:grid-cols-2">
      {builds.map((b, i) => (
        <Card as="div" key={i} data-build={i + 1} className="grid grid-cols-[1fr_76px] gap-2 p-2">
          <div className="grid grid-cols-7 gap-1">
            {b.talents.map((t) => (
              <button
                key={t.level}
                type="button"
                data-talent
                aria-label={`${t.level}레벨 · ${t.ko} — 설명 보기`}
                onClick={(e) => open(e, t)}
                className="group flex min-w-0 flex-col items-center gap-0.5"
              >
                {t.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={assetUrl(`img/talents/${t.icon}`)} alt="" loading="lazy" className="size-9 rounded-md border border-line bg-surface-3 group-hover:border-primary sm:size-11" />
                ) : (
                  <span className="size-9 rounded-md border border-line bg-surface-3 sm:size-11" />
                )}
                <span data-level className="text-[10px] text-muted">
                  {t.level}
                </span>
                <span data-tname className="line-clamp-2 text-center text-[10px] leading-tight text-fg-2 sm:text-[11px]">
                  {t.ko}
                </span>
              </button>
            ))}
          </div>
          <div className="num flex flex-col justify-center text-right">
            <span data-wr className={cx("text-lg font-extrabold", b.win_rate >= 50 ? "text-pos" : "text-neg")}>
              {pct(b.win_rate)}
            </span>
            <span className="text-[10px] text-muted">승률</span>
            <span className="text-[13px] text-fg">{int(b.games)}</span>
            <span className="text-[10px] text-muted">게임</span>
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
          aria-label={`${pop.t.ko} 설명`}
          onClick={(e) => e.stopPropagation()}
          style={{ left: pop.left, top: pop.top, width: pop.width }}
          className="absolute z-60 rounded-xl border border-line-strong bg-[#1f2638] px-3.5 py-3 shadow-[0_16px_40px_rgba(0,0,0,0.55)]"
        >
          <div className="flex items-center gap-2.5">
            {pop.t.icon && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={assetUrl(`img/talents/${pop.t.icon}`)} alt="" className="size-9 rounded-md border border-line" />
            )}
            <div>
              <div data-pop-name className="text-sm font-extrabold text-white">
                {pop.t.ko}
              </div>
              <div data-pop-level className="text-2xs text-muted">
                {pop.t.level}레벨{pop.t.cd ? ` · ${pop.t.cd.replace(/\{\{|\}\}/g, "")}` : ""}
              </div>
            </div>
          </div>
          <p data-pop-desc className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-[#cfd6e6]">
            {descParts(pop.t.desc).map((p, i) =>
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
