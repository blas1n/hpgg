"use client";

import { hotsHref, shortDate, type Mode } from "@/data";
import { useLocale, useT } from "@/i18n/client";
import type { PatchHeroRow, PatchImpact, PatchSummary } from "@/lib/patchSummary";
import { PageHead } from "@/components/PageHead";
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
        {m.rows.length ? <Rows rows={m.rows} /> : <p className="px-4 py-6 text-center text-[13px] text-muted">{t.patches.none}</p>}
        <p className="border-t border-line px-4 py-2.5 text-2xs text-muted">{t.patches.rule}</p>
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

function Rows({ rows }: { rows: PatchHeroRow[] }) {
  const t = useT();
  const href = hotsHref(useLocale());
  return (
    <table className="num w-full table-fixed border-collapse text-[13px] sm:text-sm">
      <thead>
        <tr className="border-b border-line text-xs text-muted">
          <th className="py-2 pl-4 text-left font-semibold">{t.common.hero}</th>
          <th className="w-[4.5rem] py-2 text-left font-semibold sm:w-36">{t.patches.change}</th>
          <th className="w-[5.5rem] py-2 text-right font-semibold sm:w-52">{t.common.modes.qm}</th>
          <th className="w-[5.5rem] py-2 pr-4 text-right font-semibold sm:w-52">{t.common.modes.sl}</th>
        </tr>
      </thead>
      <tbody id="patch-rows">
        {rows.map((r) => (
          <tr key={r.hero.slug} data-hero={r.hero.slug} className="border-b border-line/70 last:border-b-0">
            <td className="overflow-hidden py-1.5 pl-4">
              {/* the hero page's own patch section has the changed lines */}
              <a href={`${href.hero(r.hero.slug)}#patches-title`} className="flex min-w-0 items-center gap-2.5 hover:text-primary">
                <Portrait src={r.hero.portrait} size={28} role={r.hero.role} />
                <span className="truncate font-semibold text-fg">{r.hero.ko}</span>
              </a>
            </td>
            <td className="py-1.5">
              <span className="flex flex-wrap gap-1">
                {r.isNew && <span data-badge="new" className="rounded border border-primary/50 px-1.5 py-px text-2xs font-bold text-primary">{t.patches.newBadge}</span>}
                {r.verdict && (
                  <span data-verdict={r.verdict} className={cx("rounded border px-1.5 py-px text-2xs font-bold", VERDICT_TONE[r.verdict])}>
                    {t.hero.patchVerdict[r.verdict]}
                  </span>
                )}
                {r.hotfix && <span data-badge="hotfix" className="rounded border border-line px-1.5 py-px text-2xs font-bold text-fg-2">{t.hero.hotfixBadge}</span>}
              </span>
            </td>
            <td data-mode="qm" className="py-1.5 text-right">
              <Impact v={r.qm} />
            </td>
            <td data-mode="sl" className="py-1.5 pr-4 text-right">
              <Impact v={r.sl} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One mode: #before → #after ▲▼ and the win rate; on a phone the rank, ▲▼ and win rate only, so the name keeps its room. */
function Impact({ v }: { v: PatchImpact | null }) {
  const t = useT();
  if (!v || v.rank === null) return <span className="text-2xs text-muted">{t.patches.unranked}</span>;
  return (
    <span className="inline-flex flex-col items-end leading-4">
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
    </span>
  );
}
