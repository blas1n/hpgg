import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { assetUrl, fallbackNote, hotsHref, shortDate } from "@/data";
import { Card, CardHeader, cx, MoreLink, Portrait, TierBadge, wrTone } from "@/components/ui";
import { mapDetail } from "@/lib/maps";
import { readHeroes, readMaps, readMapsMeta, readMeta, readShown } from "@/server/data";

export const dynamicParams = false;

export function generateStaticParams(): { slug: string }[] {
  return readMaps().maps.map((m) => ({ slug: m.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const m = readMaps().maps.find((x) => x.slug === slug);
  if (!m) return {};
  return {
    title: m.ko,
    description: `${m.ko}(${m.name}): 전장 목표와 폭풍 리그에서 이 전장 승률이 높은 영웅.`,
    openGraph: m.image ? { images: [`/${m.image}`] } : undefined,
  };
}

const pct = (n: number) => `${n.toFixed(1)}%`;
const int = (n: number) => n.toLocaleString("ko-KR");

/** 전장 상세: the objective as the official site describes it, and how heroes do on this map in Storm League. */
export default async function MapPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const map = readMaps().maps.find((m) => m.slug === slug);
  if (!map) notFound();
  const meta = readMeta();
  const info = readMapsMeta()?.maps[slug];
  const { snap: sl, fallback } = readShown("sl")!; // same patch rule as every page (lib/shown.ts)
  const min = meta.min_games_for_tier;
  const d = mapDetail(sl, map.name, readHeroes(), min);
  const tierHref = hotsHref.tier(new URLSearchParams({ mode: "sl", map: map.name }));

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
            {map.name} · 폭풍 리그 · 패치 {sl.patch} · {d.matches ? `${int(d.matches)} 매치` : "표본 없음"} · {shortDate(sl.collected_at)} 갱신
            {fallback && <span data-fallback> · {fallbackNote(meta.current_patch)}</span>}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
        <Card aria-labelledby="h-objective">
          <CardHeader id="h-objective" title="전장 목표" />
          {info ? (
            <>
              <ol id="objective" className="divide-y divide-line">
                {info.objective.map((s, i) => (
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
                출처:{" "}
                <a id="objective-source" href={info.source.url} rel="noopener" className="text-secondary hover:text-primary">
                  히어로즈 오브 더 스톰 공식 사이트 전장 소개
                </a>{" "}
                (지금은 내려간 페이지의 보관본)
              </p>
            </>
          ) : (
            <p id="objective" className="px-4 py-6 text-center text-[13px] text-muted">
              이 전장의 목표 설명이 아직 없습니다
            </p>
          )}
        </Card>

        <Card id="map-top" aria-labelledby="h-map-top">
          <CardHeader
            id="h-map-top"
            title="이 전장 승률 상위 영웅"
            sub={d.qualified ? `폭풍 리그 · 이 전장 ${min}게임 이상 ${d.qualified}명 중` : `폭풍 리그 · ${min}게임 이상만`}
            action={
              <span id="map-tier-link">
                <MoreLink href={tierHref}>이 전장 티어표</MoreLink>
              </span>
            }
          />
          {d.top.length ? (
            <table className="num w-full table-fixed border-collapse text-[13px] sm:text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th className="w-9 py-2 pl-4 text-left font-semibold">#</th>
                  <th className="py-2 pl-1 text-left font-semibold">영웅</th>
                  <th className="w-24 py-2 pr-3 text-right font-semibold sm:w-32">승률</th>
                  <th className="hidden w-20 py-2 pr-3 text-right font-semibold sm:table-cell">픽률</th>
                  <th className="w-16 py-2 pr-4 text-right font-semibold sm:w-20">게임</th>
                </tr>
              </thead>
              <tbody>
                {d.top.map((t, i) => (
                  <tr key={t.hero.slug} data-hero={t.hero.slug} className="border-b border-line/70 last:border-b-0">
                    <td className="py-1.5 pl-4 font-bold text-fg">{i + 1}</td>
                    <td className="overflow-hidden py-1.5 pl-1">
                      <a href={hotsHref.hero(t.hero.slug, "sl")} className="flex min-w-0 items-center gap-2.5 hover:text-primary">
                        <Portrait src={t.hero.portrait} size={28} role={t.hero.role || undefined} />
                        <span className="truncate font-semibold text-fg">{t.hero.ko}</span>
                        <span title="이 전장 티어">
                          <TierBadge tier={t.tier} size="sm" />
                        </span>
                      </a>
                    </td>
                    <td data-col="win_rate" className={cx("py-1.5 pr-3 text-right font-semibold", wrTone(t.win_rate))}>
                      <span data-v>{pct(t.win_rate)}</span>
                      <span className="ml-1 hidden text-2xs font-normal text-muted sm:inline">±{t.wrHalf.toFixed(1)}</span>
                    </td>
                    <td className="hidden py-1.5 pr-3 text-right text-fg-2 sm:table-cell">{pct(t.pick)}</td>
                    <td className="py-1.5 pr-4 text-right text-fg-2">{int(t.games)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-4 py-6 text-center text-[13px] text-muted">
              {d.matches ? `이 전장에서 ${min}게임 이상 치른 영웅이 아직 없습니다` : "이번 패치 폭풍 리그에서 이 전장 표본이 없습니다"}
            </p>
          )}
        </Card>
      </div>
    </main>
  );
}
