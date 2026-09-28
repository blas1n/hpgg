import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegacyPage } from "@/legacy/LegacyPage";
import { HERO_HTML } from "@/legacy/markup";
import { readHeroes } from "@/server/data";

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
    description: `${h.ko}(${h.name}) ${h.role_ko} — 티어, 승률, 픽률, 밴률, 전장별 성적, 리그 구간별 성적, 인기 특성 빌드.`,
    openGraph: h.portrait ? { images: [`/${h.portrait}`] } : undefined,
  };
}

export default async function HeroPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!readHeroes().heroes.some((h) => h.slug === slug)) notFound();
  return <LegacyPage page="hero" html={HERO_HTML} slug={slug} />;
}
