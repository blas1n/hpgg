import type { Metadata } from "next";
import { TierView } from "@/components/tier/TierView";
import { resolvePatch, tierTable } from "@/lib/tier";
import { readHeroes, readMaps, readMeta, readSnapshot } from "@/server/data";

export const metadata: Metadata = {
  title: "영웅 티어",
  description: "히어로즈 오브 더 스톰 티어표. 빠른 대전 기본, 폭풍 리그는 전장별·구간별. 공식 공개.",
};

/** 영웅 티어 — the default view (Quick Match, all maps) is computed at build time; other views load their snapshot. */
export default function TierPage() {
  const meta = readMeta();
  const heroes = readHeroes();
  const { patch } = resolvePatch(meta, "qm", "auto");
  const snap = readSnapshot("qm", patch)!;
  const previous = patch === "current" ? readSnapshot("qm", "previous") : null;
  const table = tierTable(snap, previous, "all", heroes, meta.min_games_for_tier);
  return <TierView meta={meta} heroes={heroes} maps={readMaps()} initial={{ table, patch }} />;
}
