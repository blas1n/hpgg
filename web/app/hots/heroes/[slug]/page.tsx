import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HeroView, type HeroModeModel } from "@/components/hero/HeroView";
import type { Mode } from "@/data";
import { bracketRows, heroBuilds, heroSummary, mapRows } from "@/lib/hero";
import { matchupsView } from "@/lib/matchups";
import { readBuilds, readHeroes, readMaps, readMatchups, readMeta, readShown, readTalents } from "@/server/data";

export const dynamicParams = false;

export function generateStaticParams(): { slug: string }[] {
  return readHeroes().heroes.map((h) => ({ slug: h.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const h = readHeroes().heroes.find((x) => x.slug === slug);
  if (!h) return {};
  return {
    title: h.ko,
    description: `${h.ko}(${h.name}) ${h.role_ko} — 티어, 승률, 픽률, 밴률, 전장별 성적, 리그 구간별 성적, 상대하기 어려운 영웅·잘 맞는 영웅, 인기 특성 빌드.`,
    openGraph: h.portrait ? { images: [`/${h.portrait}`] } : undefined,
  };
}

/** 영웅 상세 — both modes computed at build time; the page fetches nothing. */
export default async function HeroPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const hero = readHeroes().heroes.find((h) => h.slug === slug);
  if (!hero) notFound();
  const meta = readMeta();
  const maps = readMaps();
  const min = meta.min_games_for_tier;
  const model = (mode: Mode): HeroModeModel => {
    const { snap, previous, fallback } = readShown(mode)!;
    return {
      patch: snap.patch,
      collectedAt: snap.collected_at,
      fallbackFrom: fallback ? meta.current_patch : null,
      summary: heroSummary(snap, previous, hero.name, min),
      maps: mapRows(snap, hero.name, maps, min),
      brackets: mode === "sl" ? bracketRows([{ key: "low", snap: readShown("sl", "low")?.snap ?? null }, { key: "high", snap: readShown("sl", "high")?.snap ?? null }], hero.name, min) : [],
    };
  };
  const builds = readBuilds();
  return <HeroView hero={hero} models={{ qm: model("qm"), sl: model("sl") }} builds={heroBuilds(builds, readTalents(slug), hero.name)} buildsPatch={builds?.patch ?? null} matchups={matchupsView(readMatchups(slug), readHeroes())} minGames={min} />;
}
