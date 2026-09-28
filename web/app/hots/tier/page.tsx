import type { Metadata } from "next";
import { LegacyPage } from "@/legacy/LegacyPage";
import { TIER_HTML } from "@/legacy/markup";

export const metadata: Metadata = {
  title: "영웅 티어",
  description: "히어로즈 오브 더 스톰 티어표. 빠른 대전 기본, 폭풍 리그는 전장별·구간별. 공식 공개.",
};

export default function TierPage() {
  return <LegacyPage page="tier" html={TIER_HTML} />;
}
