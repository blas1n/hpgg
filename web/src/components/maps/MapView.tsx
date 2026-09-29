"use client";

import { assetUrl, hotsHref, shortDate, type MapTable } from "@/data";
import { useLocale, useT } from "@/i18n/client";
import { mapObjective, type MapDetail, type MapInfo } from "@/lib/maps";
import { Card, CardHeader, cx, MoreLink, Portrait, TierBadge, wrTone } from "../ui";

const pct = (n: number) => `${n.toFixed(1)}%`;
const int = (n: number) => n.toLocaleString("ko-KR");

/** 전장 상세: the objective as the official site describes it, and how heroes do on this map in Storm League. */
export function MapView({
  map,
  info,
  detail: d,
  patch,
  collectedAt,
  fallbackFrom,
  minGames: min,
}: {
  map: MapTable["maps"][number];
  info: MapInfo | null;
  detail: MapDetail;
  patch: string;
  collectedAt: string;
  fallbackFrom: string | null;
  minGames: number;
}) {
  const t = useT();
  const locale = useLocale();
  const href = hotsHref(locale);
  const tierHref = href.tier(new URLSearchParams({ mode: "sl", map: map.name }));
  const objective = info ? mapObjective(info, locale) : null;

  return (
    <main className="page-x mt-6 space-y-4 pb-10">
      <div id="map-banner" className="relative overflow-hidden rounded-card border border-line bg-surface">
        {map.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={assetUrl(map.image)} alt="" className="h-40 w-full object-cover sm:h-56" />
        )}
        <span className="absolute inset-0 bg-gradient-to-t from-surface via-surface/50 to-transparent" />
        <div className="absolute inset-x-4 bottom-3">
          <h1 className="text-2xl font-extrabold tracking-tight text-fg sm:text-3xl">{map.ko}</h1>
          <p id="meta-line" className="num mt-0.5 text-xs text-fg-2">
            {[map.name !== map.ko && map.name, t.common.modes.sl, t.common.patch(patch), d.matches ? t.common.matches(int(d.matches)) : t.common.noSample, t.common.updated(shortDate(collectedAt))]
              .filter(Boolean)
              .join(" · ")}
            {fallbackFrom && <span data-fallback> · {t.common.fallbackNote(fallbackFrom)}</span>}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
        <Card aria-labelledby="h-objective">
          <CardHeader id="h-objective" title={t.map.objective} />
          {objective ? (
            <>
              {objective.fallback && (
                <p id="objective-fallback" className="border-b border-line px-4 py-2.5 text-2xs text-muted">
                  {t.map.koreanFallback}
                </p>
              )}
              <ol id="objective" lang={objective.fallback ? "ko" : undefined} className="divide-y divide-line">
                {objective.steps.map((s, i) => (
                  <li key={s.title} className="grid grid-cols-[28px_1fr] gap-3 px-4 py-3">
                    <span className="num grid size-7 place-items-center rounded-full bg-surface-3 text-[13px] font-bold text-fg">{i + 1}</span>
                    <span>
                      <span className="block text-sm font-bold text-fg">{s.title}</span>
                      <span className="mt-0.5 block text-[13px] leading-relaxed text-fg-2">{s.text}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <p className="border-t border-line px-4 py-2.5 text-2xs text-muted">
                {t.map.source}{" "}
                <a id="objective-source" href={objective.source.url} rel="noopener" className="text-secondary hover:text-primary">
                  {t.map.sourceLink}
                </a>{" "}
                {t.map.sourceArchived}
              </p>
            </>
          ) : (
            <p id="objective" className="px-4 py-6 text-center text-[13px] text-muted">
              {t.map.noObjective}
            </p>
          )}
        </Card>

        <Card id="map-top" aria-labelledby="h-map-top">
          <CardHeader
            id="h-map-top"
            title={t.map.topTitle}
            sub={d.qualified ? t.map.topSub(String(min), String(d.qualified)) : t.map.topSubEmpty(String(min))}
            action={
              <span id="map-tier-link">
                <MoreLink href={tierHref}>{t.map.tierLink}</MoreLink>
              </span>
            }
          />
          {d.top.length ? (
            <table className="num w-full table-fixed border-collapse text-[13px] sm:text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th className="w-9 py-2 pl-4 text-left font-semibold">#</th>
                  <th className="py-2 pl-1 text-left font-semibold">{t.common.hero}</th>
                  <th className="w-24 py-2 pr-3 text-right font-semibold sm:w-32">{t.common.winRate}</th>
                  <th className="hidden w-20 py-2 pr-3 text-right font-semibold sm:table-cell">{t.common.pickRate}</th>
                  <th className="w-16 py-2 pr-4 text-right font-semibold sm:w-20">{t.map.games}</th>
                </tr>
              </thead>
              <tbody>
                {d.top.map((row, i) => (
                  <tr key={row.hero.slug} data-hero={row.hero.slug} className="border-b border-line/70 last:border-b-0">
                    <td className="py-1.5 pl-4 font-bold text-fg">{i + 1}</td>
                    <td className="overflow-hidden py-1.5 pl-1">
                      <a href={href.hero(row.hero.slug, "sl")} className="flex min-w-0 items-center gap-2.5 hover:text-primary">
                        <Portrait src={row.hero.portrait} size={28} role={row.hero.role || undefined} />
                        <span className="truncate font-semibold text-fg">{row.hero.ko}</span>
                        <span title={t.map.tierTitle}>
                          <TierBadge tier={row.tier} size="sm" />
                        </span>
                      </a>
                    </td>
                    <td data-col="win_rate" className={cx("py-1.5 pr-3 text-right font-semibold", wrTone(row.win_rate))}>
                      <span data-v>{pct(row.win_rate)}</span>
                      <span className="ml-1 hidden text-2xs font-normal text-muted sm:inline">±{row.wrHalf.toFixed(1)}</span>
                    </td>
                    <td className="hidden py-1.5 pr-3 text-right text-fg-2 sm:table-cell">{pct(row.pick)}</td>
                    <td className="py-1.5 pr-4 text-right text-fg-2">{int(row.games)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-4 py-6 text-center text-[13px] text-muted">{d.matches ? t.map.noneQualified(String(min)) : t.map.noSample}</p>
          )}
        </Card>
      </div>
    </main>
  );
}
