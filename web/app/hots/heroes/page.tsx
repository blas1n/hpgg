import type { Metadata } from "next";
import { LegacyPage } from "@/legacy/LegacyPage";
import { HEROES_HTML } from "@/legacy/markup";

export const metadata: Metadata = { title: "영웅", description: "히어로즈 오브 더 스톰 영웅 목록 — 역할별, 현재 티어와 함께." };

export default function HeroesPage() {
  return <LegacyPage page="heroes" html={HEROES_HTML} />;
}
