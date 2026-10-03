"use client";

import { hotsHref, shortDate, type Mode } from "@/data";
import { useLocale, useT } from "@/i18n/client";
import type { PatchHeroRow, PatchImpact, PatchSummary } from "@/lib/patchSummary";
import { PageHead } from "@/components/PageHead";
import { ChangeGroups } from "./ChangeGroups";
import { Card, CardHeader, cx, Portrait, RankDelta } from "../ui";

const pct = (n: number) => `${n.toFixed(1)}%`;
const wrClass = (wr: number) => (wr >= 50 ? "text-pos" : "text-neg");
// the hero page's verdict colours (HeroView)
const VERDICT_TONE = {
  buff: "border-pos/40 text-pos",
  nerf: "border-neg/40 text-neg",
  mixed: "border-warn-line bg-warn-bg text-warn-fg",
} as const;

/** 패치 요약: one page for the patch — what changed is the same in every mode; only the ranks differ, so the two modes
 *  sit side by side (owner 10-03: a mode toggle made it look like two patches). */
export function PatchesView({ model: m, collectedAt }: { model: PatchSummary; collectedAt: string }) {
  const t = useT();
  return (
    <main className="page-x mt-6 space-y-6">
      <PageHead title={t.patches.title}>
        <p id="meta-line" className="num mt-0.5 text-xs text-muted">
          {t.patches.metaLine(m.patch, m.previousPatch)} · {t.common.updated(shortDate(collectedAt))}
        </p>
      </PageHead>

      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-7" aria-labelledby="h-summary">
          <CardHeader id="h-summary" title={t.patches.summaryTitle} />
          <Summary model={m} />
        </Card>
        <Card className="lg:col-span-5 lg:self-start" aria-labelledby="h-notes">
          <CardHeader id="h-notes" title={t.patches.notesTitle} />
          {m.notes.length ? (
            <ul id="patch-notes" className="divide-y divide-line">
              {m.notes.map((n) => (
                <li key={n.id} className="px-4 py-2.5">
                  <a href={n.url} rel="noopener" target="_blank" className="text-[13px] font-semibold text-fg hover:text-primary">
                    {n.title}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-4 text-[13px] text-muted">{t.patches.noNotes}</p>
          )}
        </Card>
      </div>

      <Card aria-labelledby="h-changed">
        <CardHeader id="h-changed" title={t.patches.tableTitle} sub={m.previousPatch ? t.patches.tableSub(m.previousPatch) : t.patches.tableSubNoPrev} />
        {m.rows.length ? <Heroes rows={m.rows} /> : <p className="px-4 py-6 text-center text-[13px] text-muted">{t.patches.none}</p>}
        <p className="border-t border-line px-4 py-2.5 text-2xs leading-relaxed text-muted">
          {t.hero.patchesRule} {t.patches.rule}
        </p>
      </Card>
    </main>
  );
}

/** At most three short lines, all numbers (owner: copy is short and factual). */
function Summary({ model: m }: { model: PatchSummary }) {
  const t = useT();
  const fresh = m.rows.filter((r) => r.isNew).map((r) => r.hero.ko);
  const first = [t.patches.counts(String(m.counts.buff), String(m.counts.nerf), String(m.counts.mixed)), fresh.length ? t.patches.newHeroes(fresh.join(", ")) : null, m.counts.hotfix ? t.patches.hotfixes(String(m.counts.hotfix)) : null].filter(Boolean).join(" · ");
  const moves = (pick: PatchSummary["up"]) =>
    (["qm", "sl"] as const).flatMap((mode) => {
      const r = pick[mode];
      return r && r[mode] ? [t.patches.move(t.common.modes[mode], r.hero.ko, String(r[mode]!.prevRank), String(r[mode]!.rank))] : [];
    }).join(" · ");
  const up = moves(m.up);
  const down = moves(m.down);
  const lines = [first, up && t.patches.up(up), down && t.patches.down(down)].filter(Boolean);
  return (
    <ol id="patch-summary" className="num space-y-1.5 px-4 py-3 text-[13px] text-fg-2">
      {lines.map((l) => (
        <li key={l as string}>{l}</li>
      ))}
    </ol>
  );
}

/** Every changed hero with this patch's lines (owner 10-04: read the changes here, the hero page is one click away). */
function Heroes({ rows }: { rows: PatchHeroRow[] }) {
  const t = useT();
  const href = hotsHref(useLocale());
  return (
    <div id="patch-rows" className="grid items-start gap-3 p-3 lg:grid-cols-2">
      {rows.map((r) => (
        <article key={r.hero.slug} data-hero={r.hero.slug} className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
          <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <a href={href.hero(r.hero.slug)} data-hero-link className="flex min-w-0 items-center gap-2.5 hover:text-primary">
              <Portrait src={r.hero.portrait} size={36} role={r.hero.role} />
              <span className="truncate text-[15px] font-bold text-fg">{r.hero.ko}</span>
            </a>
            <span className="flex flex-wrap gap-1">
              {r.isNew && <span data-badge="new" className="rounded border border-primary/50 px-1.5 py-px text-2xs font-bold text-primary">{t.patches.newBadge}</span>}
              {r.verdict && (
                <span data-verdict={r.verdict} className={cx("rounded border px-1.5 py-px text-2xs font-bold", VERDICT_TONE[r.verdict])}>
                  {t.hero.patchVerdict[r.verdict]}
                </span>
              )}
              {r.hotfix && <span data-badge="hotfix" className="rounded border border-line px-1.5 py-px text-2xs font-bold text-fg-2">{t.hero.hotfixBadge}</span>}
            </span>
            <span className="ml-auto flex gap-3 text-right">
              <Impact mode="qm" v={r.qm} />
              <Impact mode="sl" v={r.sl} />
            </span>
          </header>
          <div className="mt-2 border-t border-line/70 pt-2">
            {r.groups.length ? (
              <ChangeGroups groups={r.groups} label={(g) => (g.source === "hotfix" ? t.hero.hotfixBadge : null)} />
            ) : (
              <p className="text-[13px] text-muted">{r.isNew ? t.patches.newHero : ""}</p>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

/** One mode: its name, #before → #after ▲▼ and the win rate (on a phone the after only). */
function Impact({ mode, v }: { mode: Mode; v: PatchImpact | null }) {
  const t = useT();
  return (
    <span data-mode={mode} className="inline-flex flex-col items-end leading-4">
      <span className="text-2xs text-muted">{t.common.modes[mode]}</span>
      {!v || v.rank === null ? <span className="text-2xs text-muted">{t.patches.unranked}</span> : <Ranks v={v} />}
    </span>
  );
}

function Ranks({ v }: { v: PatchImpact }) {
  return (
    <>
      <span className="inline-flex items-center gap-1.5">
        {v.prevRank !== null && <span className="hidden text-2xs text-muted sm:inline">#{v.prevRank} →</span>}
        <span className="font-semibold text-fg">#{v.rank}</span>
        <RankDelta value={v.delta} />
      </span>
      {v.wr !== null && (
        <span className="text-2xs">
          {v.prevWr !== null && <span className="hidden text-muted sm:inline">{pct(v.prevWr)} → </span>}
          <span className={wrClass(v.wr)}>{pct(v.wr)}</span>
        </span>
      )}
    </>
  );
}
