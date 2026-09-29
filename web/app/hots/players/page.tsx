import type { Metadata } from "next";
import { PlayerSearchView } from "@/components/players/PlayerSearchView";
import { readHeroes, readMaps } from "@/server/data";

export const metadata: Metadata = {
  title: "전적 검색",
  description: "히어로즈 오브 더 스톰 전적 검색: 배틀태그로 모드별 MMR·리그, 최근 경기, 많이 한 영웅.",
};

/** 전적 검색 — a static shell; the search runs in the browser against our API
 * (NEXT_PUBLIC_API_BASE, default https://api.hpgg.win). Hero and map names come from the build. */
export default function PlayersPage() {
  return <PlayerSearchView heroes={readHeroes()} maps={readMaps()} />;
}
