import type { Metadata } from "next";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { readSearchIndex } from "@/server/data";

export const metadata: Metadata = {
  title: { absolute: "HPGG · Heroes of the Storm · 티어표 · 영웅 통계 · 메타 변동", template: "%s | HPGG · Heroes of the Storm" },
  description: "히어로즈 오브 더 스톰 티어표 · 영웅 통계. 빠른 대전 기본, 폭풍 리그는 전장별·구간별. 공식 공개, 매일 갱신.",
};

export default function HotsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader searchIndex={readSearchIndex()} />
      <div className="min-h-[70vh]">{children}</div>
      <SiteFooter />
    </>
  );
}
