"use client";

import { useEffect, useState } from "react";
import { hotsHref, shortDate, type Mode } from "@/data";
import { useLocale, useT } from "@/i18n/client";
import type { PatchHeroRow, PatchSummary } from "@/lib/patchSummary";
import { PageHead } from "@/components/PageHead";
import { Card, CardHeader, cx, Portrait, RankDelta, Segmented } from "../ui";

const pct = (n: number) => `${n.toFixed(1)}%`;
const wrClass = (wr: number) => (wr >= 50 ? "text-pos" : "text-neg");
// the hero page's verdict colours (HeroView)
const VERDICT_TONE = {
  buff: "border-pos/40 text-pos",
  nerf: "border-neg/40 text-neg",
  mixed: "border-warn-line bg-warn-bg text-warn-fg",
} as const;

/** 패치 요약: both modes pre-rendered; the toggle only swaps them (ranks differ per mode, the changes do not). */
export function PatchesView({ models, collectedAt }: { models: Record<Mode, PatchSummary>; collectedAt: string }) {
  const t = useT();
  const [mode, setMode] = useState<Mode>("qm");
  useEffect(() => {
    if (new URLSearchParams(location.search).get("mode") === "sl") setMode("sl");
  }, []);
  const change = (m: Mode) => {
    setMode(m);
    history.replaceState(null, "", location.pathname + (m === "sl" ? "?mode=sl" : ""));
  };
  const m = models[mode];

  return (
    <main className="page-x mt-6 space-y-6">
      <PageHead
        title={t.patches.title}
        aside={
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
        }
      >
        <p id="meta-line" className="num mt-0.5 text-xs text-muted">
          {t.common.modes[mode]} · {t.patches.metaLine(m.patch, m.previousPatch)} · {t.common.updated(shortDate(collectedAt))}
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
        {m.rows.length ? <Rows rows={m.rows} mode={mode} /> : <p className="px-4 py-6 text-center text-[13px] text-muted">{t.patches.none}</p>}
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
  const lines = [first, m.up && t.patches.up(m.up.hero.ko, String(m.up.prevRank), String(m.up.rank)), m.down && t.patches.down(m.down.hero.ko, String(m.down.prevRank), String(m.down.rank))].filter(Boolean);
  return (
    <ol id="patch-summary" className="num space-y-1.5 px-4 py-3 text-[13px] text-fg-2">
      {lines.map((l) => (
        <li key={l as string}>{l}</li>
      ))}
    </ol>
  );
}

function Rows({ rows, mode }: { rows: PatchHeroRow[]; mode: Mode }) {
  const t = useT();
  const href = hotsHref(useLocale());
  return (
    <table className="num w-full table-fixed border-collapse text-[13px] sm:text-sm">
      <thead>
        <tr className="border-b border-line text-xs text-muted">
          <th className="py-2 pl-4 text-left font-semibold">{t.common.hero}</th>
          <th className="w-[4.5rem] py-2 text-left font-semibold sm:w-36">{t.patches.change}</th>
          <th className="w-20 py-2 text-right font-semibold sm:w-36">{t.patches.rank}</th>
          <th className="w-[4.5rem] py-2 pr-4 text-right font-semibold sm:w-40">{t.common.winRate}</th>
        </tr>
      </thead>
      <tbody id="patch-rows">
        {rows.map((r) => (
          <tr key={r.hero.slug} data-hero={r.hero.slug} className="border-b border-line/70 last:border-b-0">
            <td className="overflow-hidden py-1.5 pl-4">
              {/* the hero page's own patch section has the changed lines */}
              <a href={`${href.hero(r.hero.slug, mode)}#patches-title`} className="flex min-w-0 items-center gap-2.5 hover:text-primary">
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
            <td className="py-1.5 text-right">
              {r.rank === null ? (
                <span className="text-2xs text-muted">{t.patches.unranked}</span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  {/* before → after on wider screens; on a phone the ▲▼ says it and the name keeps its room */}
                  {r.prevRank !== null && <span className="hidden text-2xs text-muted sm:inline">#{r.prevRank} →</span>}
                  <span className="font-semibold text-fg">#{r.rank}</span>
                  <RankDelta value={r.delta} />
                </span>
              )}
            </td>
            <td className="py-1.5 pr-4 text-right">
              {r.prevWr !== null && <span className="hidden text-2xs text-muted sm:inline">{pct(r.prevWr)} → </span>}
              {r.wr !== null ? <span className={cx("font-semibold", wrClass(r.wr))}>{pct(r.wr)}</span> : <span className="text-muted">–</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
