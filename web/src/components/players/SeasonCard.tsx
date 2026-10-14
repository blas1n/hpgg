"use client";

import { useMemo, useState } from "react";
import type { HeroTable } from "@/data";
import { useLocale, useT } from "@/i18n/client";
import type { MatchesResult } from "@/lib/matches";
import { qmCard, seasonCard, type SeasonCardView, type SeasonHeroView, type SeasonResult } from "@/lib/season";
import { Card, CardHeader, cx, Portrait, Segmented } from "../ui";

type Mode = "sl" | "qm";
const SHOWN = 7;
const pct = (n: number | null) => (n === null ? "–" : `${n.toFixed(0)}%`);
const wr = (n: number | null) => (n === null ? "text-muted" : n >= 50 ? "text-pos" : "text-neg");
const two = (n: number | null) => (n === null ? "–" : n.toFixed(2));
const one = (n: number) => n.toFixed(1);
const int = (n: number) => Math.round(n).toLocaleString("ko-KR");

/** 이번 시즌 (owner 2026-10-14): Storm League this season from /v1/players/season, Quick Match from the match list. */
export function SeasonCard({ season, games, heroes }: { season: { kind: "loading" } | SeasonResult; games: { kind: "loading" } | MatchesResult; heroes: HeroTable }) {
  const t = useT().players.season;
  const locale = useLocale();
  const sl = season.kind === "ok" ? season.data : null;
  const qmRows = games.kind === "ok" ? games.data.matches : null;
  const slView = useMemo(() => (sl ? seasonCard(sl.heroes, heroes, locale) : null), [sl, heroes, locale]);
  const qmView = useMemo(() => (qmRows ? qmCard(qmRows, heroes, locale) : null), [qmRows, heroes, locale]);
  const [picked, setPicked] = useState<Mode | null>(null);
  // Storm League first; Quick Match when the player has none this season
  const mode: Mode = picked ?? (slView && slView.games === 0 && qmView && qmView.games > 0 ? "qm" : "sl");
  const view = mode === "sl" ? slView : qmView;
  const loading = mode === "sl" ? season.kind === "loading" : games.kind === "loading";

  let note: string | null = null;
  if (!view && !loading) note = mode === "sl" && season.kind === "quota" ? t.quota : t.error;
  else if (view && view.games === 0) note = mode === "sl" ? t.emptySl : t.emptyQm;
  // Quick Match says what its numbers cover; Storm League needs no subtitle (owner 2026-10-14)
  const sub = mode === "qm" && view && view.games > 0 ? t.qmSub(String(view.games)) : undefined;

  return (
    <Card aria-labelledby="h-season">
      <CardHeader id="h-season" title={t.title} sub={sub} />
      <div className="border-b border-line px-4 py-2">
        <Segmented
          value={mode}
          onChange={setPicked}
          label={t.modeLabel}
          idPrefix="season-mode"
          options={[
            { value: "sl", label: t.sl },
            { value: "qm", label: t.qm },
          ]}
        />
      </div>
      <div id="player-season" data-mode={mode} data-state={loading ? "loading" : view ? "ok" : "error"}>
        {loading && <p className="px-4 py-3 text-xs text-muted">{t.loading}</p>}
        {note && <p className="px-4 py-3 text-xs text-muted">{note}</p>}
        {mode === "sl" && sl?.stale && <p className="border-b border-line bg-warn-bg px-4 py-2 text-2xs text-warn-fg">{t.stale}</p>}
        {view && view.games > 0 && <Body v={view} />}
      </div>
    </Card>
  );
}

function Body({ v }: { v: SeasonCardView }) {
  const t = useT().players.season;
  const [all, setAll] = useState(false);
  const list = all ? v.heroes : v.heroes.slice(0, SHOWN);
  return (
    <>
      <dl id="season-summary" className="num grid grid-cols-4 gap-px border-b border-line bg-line text-center">
        <Cell k={t.games} v={String(v.games)} />
        <Cell k={t.winRate} v={pct(v.winRate)} className={wr(v.winRate)} />
        <Cell k={t.kda} v={two(v.kda)} />
        <Cell k={t.takedowns} v={v.takedowns === null ? "–" : one(v.takedowns)} />
      </dl>
      <p className="num px-4 pt-3 text-2xs text-muted">{t.record(String(v.wins), String(v.losses))}</p>

      <h3 className="px-4 pt-3 pb-1 text-xs font-bold text-fg-2">{t.most}</h3>
      <ul id="season-heroes" className="divide-y divide-line">
        {list.map((h) => (
          <HeroRow key={h.slug ?? h.name} h={h} />
        ))}
      </ul>
      {v.heroes.length > SHOWN && (
        <button id="season-more" type="button" onClick={() => setAll(!all)} className="w-full border-t border-line py-2 text-xs font-semibold text-fg-2 hover:bg-surface-2">
          {all ? t.less : t.more(String(v.heroes.length - SHOWN))}
        </button>
      )}

      <h3 className="border-t border-line px-4 pt-3 pb-1 text-xs font-bold text-fg-2">{t.roles}</h3>
      <ul id="season-roles" className="grid grid-cols-3 gap-2 px-4 pt-1 pb-4">
        {v.roles.map((r) => (
          <li key={r.role} data-role={r.role} className="rounded-lg bg-surface-2 px-2 py-2 text-center">
            <div className="truncate text-2xs text-muted">{r.label}</div>
            <div className={cx("num text-sm font-bold", wr(r.winRate))}>{pct(r.winRate)}</div>
            <div className="num text-2xs text-muted">{t.gamesN(String(r.games))}</div>
          </li>
        ))}
      </ul>
    </>
  );
}

function HeroRow({ h }: { h: SeasonHeroView }) {
  const t = useT().players;
  const s = t.season;
  const [open, setOpen] = useState(false);
  const panel = `season-hero-${h.slug ?? h.name}`;
  const body = (
    <>
      <Portrait src={h.portrait} size={34} role={h.role} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-fg">{h.name}</span>
        {h.perGame && (
          <span className="num block text-2xs text-muted">
            <span className={cx("font-semibold", h.kda !== null && h.kda >= 4 ? "text-primary" : "text-fg-2")}>{two(h.kda)}</span> KDA ·{" "}
            {one(h.perGame.kills)} / {one(h.perGame.deaths)} / {one(h.perGame.assists)}
          </span>
        )}
      </span>
      <span className="num shrink-0 text-right">
        <span className={cx("block text-sm font-bold", wr(h.winRate))}>{pct(h.winRate)}</span>
        <span className="block text-2xs text-muted">{s.gamesN(String(h.games))}</span>
      </span>
    </>
  );
  const cls = "flex min-w-0 flex-1 items-center gap-3 py-2 pl-4";
  return (
    <li data-hero={h.slug ?? undefined} data-open={open || undefined}>
      <div className="flex items-center gap-2 pr-3">
        {h.href ? (
          <a href={h.href} className={cx(cls, "transition-colors hover:bg-surface-2")}>
            {body}
          </a>
        ) : (
          <span className={cls}>{body}</span>
        )}
        {h.stats ? (
          <button
            type="button"
            data-toggle
            aria-expanded={open}
            aria-controls={panel}
            aria-label={open ? s.statsClose(h.name) : s.statsOpen(h.name)}
            title={open ? s.statsClose(h.name) : s.statsOpen(h.name)}
            onClick={() => setOpen((o) => !o)}
            className="flex size-7 shrink-0 items-center justify-center rounded-md border border-line text-fg-2 hover:border-primary hover:text-fg"
          >
            <span aria-hidden className={cx("inline-block text-xs transition-transform", open && "rotate-180")}>
              ▾
            </span>
          </button>
        ) : (
          <span className="size-7 shrink-0" />
        )}
      </div>
      {open && h.stats && (
        // the game card's stat line, averaged over the season (owner 2026-10-14)
        <dl id={panel} data-stats className="num grid grid-cols-2 gap-x-3 gap-y-0.5 px-4 pb-2.5 text-2xs">
          <Avg label={t.games.stat.heroDamage} value={int(h.stats.heroDamage)} />
          <Avg label={t.games.stat.siegeDamage} value={int(h.stats.siegeDamage)} />
          {h.stats.healing ? <Avg label={t.games.stat.healing} value={int(h.stats.healing)} /> : <Avg label={t.games.stat.damageTaken} value={int(h.stats.damageTaken)} />}
          <Avg label={t.games.stat.experience} value={int(h.stats.experience)} />
        </dl>
      )}
    </li>
  );
}

function Avg({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-line/60 py-0.5">
      <dt className="truncate text-fg-2">{label}</dt>
      <dd className="font-semibold text-fg">{value}</dd>
    </div>
  );
}

function Cell({ k, v, className }: { k: string; v: string; className?: string }) {
  return (
    <div className="bg-surface px-1 py-2.5">
      <dt className="text-2xs text-muted">{k}</dt>
      <dd className={cx("text-[15px] font-bold text-fg", className)}>{v}</dd>
    </div>
  );
}
