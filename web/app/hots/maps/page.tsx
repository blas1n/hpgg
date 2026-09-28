import type { Metadata } from "next";
import { MapCardLink } from "@/components/MapCardLink";
import { fallbackNote, shortDate } from "@/data";
import { mapCards } from "@/lib/home";
import { readHeroes, readMaps, readMeta, readShown } from "@/server/data";

export const metadata: Metadata = { title: "전장", description: "히어로즈 오브 더 스톰 전장별 매치 수와 상위 영웅, 전장별 티어표." };

/** 전장 — every map in the pool, most Storm League matches first; computed at build time, no client code. */
export default function MapsPage() {
  const meta = readMeta();
  const { snap: sl, fallback } = readShown("sl")!; // same patch rule as every page (lib/shown.ts)
  const cards = mapCards(sl, readMaps(), readHeroes(), meta.min_games_for_tier, Infinity, { keepEmpty: true });
  return (
    <main className="page-x mt-6 space-y-4 pb-10">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-white">전장</h1>
        <p id="meta-line" className="num mt-0.5 text-xs text-muted">
          폭풍 리그 · 패치 {sl.patch} · {sl.matches.toLocaleString("ko-KR")} 매치 · {shortDate(sl.collected_at)} 갱신 · 누르면 그 전장의 티어표
          {fallback && <span data-fallback> · {fallbackNote(meta.current_patch)}</span>}
        </p>
      </div>
      <div id="map-grid" className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
        {cards.map((c) => (
          <MapCardLink key={c.slug} c={c} />
        ))}
      </div>
    </main>
  );
}
