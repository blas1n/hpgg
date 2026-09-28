import { HomeView } from "@/components/home/HomeView";
import { homeModel, mapCards } from "@/lib/home";
import { readHeroes, readMaps, readMeta, readSnapshot } from "@/server/data";

/** 홈 — computed at build time for both modes; the mode toggle only swaps pre-rendered models. */
export default function HotsHome() {
  const meta = readMeta();
  const heroes = readHeroes();
  const maps = readMaps();
  const min = meta.min_games_for_tier;
  const qm = readSnapshot("qm")!;
  const sl = readSnapshot("sl")!;
  const models = {
    qm: homeModel("qm", qm, readSnapshot("qm", "previous"), meta.previous_patch, heroes, min),
    sl: homeModel("sl", sl, readSnapshot("sl", "previous"), meta.previous_patch, heroes, min),
  };
  const cards = mapCards(sl, maps, heroes, min, 6);
  return <HomeView models={models} maps={cards} />;
}
