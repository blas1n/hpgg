import type { Metadata } from "next";
import { HeroesView } from "@/components/heroes/HeroesView";
import { fallbackNote, type Mode } from "@/data";
import { readHeroes, readMeta, readSearchIndex, readShown } from "@/server/data";

export const metadata: Metadata = { title: "영웅", description: "히어로즈 오브 더 스톰 영웅 목록: 역할별, 현재 티어와 함께." };

/** 영웅 — every hero with its tier in both modes, computed at build time; the page fetches nothing. */
export default function HeroesPage() {
  const modes: Mode[] = ["qm", "sl"];
  const index = Object.fromEntries(modes.map((m) => [m, readSearchIndex(m)])) as Record<Mode, ReturnType<typeof readSearchIndex>>;
  const tiers = Object.fromEntries(modes.map((m) => [m, Object.fromEntries(index[m].flatMap((h) => (h.tier ? [[h.slug, h.tier]] : [])))])) as Record<Mode, Record<string, string>>;
  const meta = readMeta();
  const patches = Object.fromEntries(
    modes.map((m) => {
      const s = readShown(m);
      return [m, s ? `${s.snap.patch}${s.fallback ? ` · ${fallbackNote(meta.current_patch)}` : ""}` : ""];
    }),
  ) as Record<Mode, string>;
  const heroes = index.qm.map(({ tier: _tier, ...h }) => h);
  return <HeroesView heroes={heroes} roles={readHeroes().roles} tiers={tiers} patches={patches} />;
}
