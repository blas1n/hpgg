import type { Metadata } from "next";
import { LegacyPage } from "@/legacy/LegacyPage";
import { MAPS_HTML } from "@/legacy/markup";

export const metadata: Metadata = { title: "전장", description: "히어로즈 오브 더 스톰 전장별 매치 수와 상위 영웅, 전장별 티어표." };

export default function MapsPage() {
  return <LegacyPage page="maps" html={MAPS_HTML} />;
}
