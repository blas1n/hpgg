import { HomeView } from "@/components/home/HomeView";
import type { Mode } from "@/data";
import { homeModel, mapCards } from "@/lib/home";
import { readHeroes, readMaps, readMeta, readShown } from "@/server/data";

/** 홈 — computed at build time for both modes; the mode toggle only swaps pre-rendered models. */
export default function HotsHome() {
  const meta = readMeta();
  const heroes = readHeroes();
  const min = meta.min_games_for_tier;
  const model = (mode: Mode) => {
    const s = readShown(mode)!;
    return homeModel(mode, s.snap, s.previous, meta.previous_patch, heroes, min, s.fallback ? meta.current_patch : null);
  };
  const cards = mapCards(readShown("sl")!.snap, readMaps(), heroes, min, 6);
  return <HomeView models={{ qm: model("qm"), sl: model("sl") }} maps={cards} />;
}
