/**
 * Every page of the Heroes of the Storm section, once, for any language (#10). The files under app/ only pick the
 * language: each exports these with its locale, so a page is written once and pre-rendered per language.
 * Everything here runs at build time; the views are client components that read the language from LocaleProvider.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DraftView } from "@/components/draft/DraftView";
import type { Snapshot } from "@/formula";
import { HeroView, type HeroModeModel } from "@/components/hero/HeroView";
import { HeroesView } from "@/components/heroes/HeroesView";
import { HomeView } from "@/components/home/HomeView";
import { MapsView } from "@/components/maps/MapsView";
import { MapView } from "@/components/maps/MapView";
import { PlayerSearchView } from "@/components/players/PlayerSearchView";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { TierView } from "@/components/tier/TierView";
import { BRACKETS, REGIONS, referencePatchId, snapshotKey, type Bracket, type Mode, type Region } from "@/data";
import { alternates, DEFAULT_LOCALE, type Locale } from "@/i18n/locale";
import { messages } from "@/i18n/messages";
import { draftHeroes } from "@/lib/draft";
import { heroBuilds, heroGrid, heroSummary, mapRows } from "@/lib/hero";
import { homeModel, mapCards } from "@/lib/home";
import { mapDetail } from "@/lib/maps";
import { matchupsView } from "@/lib/matchups";
import { heroPatchNotes } from "@/lib/patchnotes";
import { patchSummary } from "@/lib/patchSummary";
import { PatchesView } from "@/components/patches/PatchesView";
import { tierTable } from "@/lib/tier";
import { readBuilds, readHeroes, readMaps, readMapsMeta, readMatchups, readMeta, readHotfixes, readPatchNotes, readSearchIndex, readShown, readTalents } from "@/server/data";

type Params = { params: Promise<{ slug: string }> };

// --- section layout: header (with the hero search index) and footer ---
export const hotsMetadata = (locale: Locale): Metadata => {
  const t = messages[locale].meta;
  return { title: { absolute: t.hotsTitle, template: t.hotsTemplate }, description: t.hotsDescription };
};

export function HotsShell({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return (
    <>
      <SiteHeader searchIndex={readSearchIndex(locale)} />
      <div className="min-h-[70vh]">{children}</div>
      <SiteFooter locale={locale} />
    </>
  );
}

// --- 홈: computed at build time for both modes; the mode toggle only swaps pre-rendered models ---
/** The section title and description come from the layout (hotsMetadata). */
export const homeMetadata = (locale: Locale): Metadata => ({ alternates: alternates("/hots/", locale) });

export function HomePage({ locale }: { locale: Locale }) {
  const meta = readMeta();
  const heroes = readHeroes(locale);
  const min = meta.min_games_for_tier;
  const model = (mode: Mode) => {
    const s = readShown(mode)!;
    return homeModel(mode, s.snap, s.previous, meta.previous_patch, heroes, min, s.fallback ? meta.current_patch : null);
  };
  const cards = mapCards(readShown("sl")!.snap, readMaps(locale), heroes, min, 6);
  return <HomeView models={{ qm: model("qm"), sl: model("sl") }} maps={cards} />;
}

// --- 영웅 티어: the default view (Quick Match, all maps) is computed at build time; other views load their snapshot ---
export const tierMetadata = (locale: Locale): Metadata => ({
  title: messages[locale].meta.tierTitle,
  description: messages[locale].meta.tierDescription,
  alternates: alternates("/hots/tier/", locale),
});

export function TierPage({ locale }: { locale: Locale }) {
  const meta = readMeta();
  const heroes = readHeroes(locale);
  const shown = readShown("qm")!;
  const patch = shown.fallback ? "previous" : "current";
  const table = tierTable(shown.snap, shown.previous, "all", heroes, meta.min_games_for_tier);
  return <TierView meta={meta} heroes={heroes} maps={readMaps(locale)} initial={{ table, patch }} />;
}

// --- 영웅: every hero with its tier in both modes, computed at build time; the page fetches nothing ---
export const heroesMetadata = (locale: Locale): Metadata => ({
  title: messages[locale].meta.heroesTitle,
  description: messages[locale].meta.heroesDescription,
  alternates: alternates("/hots/heroes/", locale),
});

export function HeroesPage({ locale }: { locale: Locale }) {
  const t = messages[locale];
  const modes: Mode[] = ["qm", "sl"];
  const index = Object.fromEntries(modes.map((m) => [m, readSearchIndex(locale, m)])) as Record<Mode, ReturnType<typeof readSearchIndex>>;
  const tiers = Object.fromEntries(modes.map((m) => [m, Object.fromEntries(index[m].flatMap((h) => (h.tier ? [[h.slug, h.tier]] : [])))])) as Record<Mode, Record<string, string>>;
  const meta = readMeta();
  const patches = Object.fromEntries(
    modes.map((m) => {
      const s = readShown(m);
      return [m, s ? `${s.snap.patch}${s.fallback ? ` · ${t.common.fallbackNote(meta.current_patch)}` : ""}` : ""];
    }),
  ) as Record<Mode, string>;
  const table = readHeroes(locale);
  const franchise = new Map(table.heroes.map((h) => [h.slug, h.franchise]));
  const heroes = index.qm.map(({ tier: _tier, ...h }) => ({ ...h, franchise: franchise.get(h.slug) }));
  // the universes present, in the message table's order
  const universes = Object.keys(t.common.universes).filter((u) => heroes.some((h) => h.franchise === u));
  return <HeroesView heroes={heroes} roles={table.roles} universes={universes} tiers={tiers} patches={patches} />;
}

// --- 영웅 상세: one static page per hero; both modes computed at build time; the page fetches nothing ---
export const heroParams = (): { slug: string }[] => readHeroes(DEFAULT_LOCALE).heroes.map((h) => ({ slug: h.slug }));

export async function heroMetadata(locale: Locale, { params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const h = readHeroes(locale).heroes.find((x) => x.slug === slug);
  if (!h) return {};
  return {
    title: h.ko,
    description: messages[locale].meta.heroDescription(h.ko, h.name, h.role_ko),
    alternates: alternates(`/hots/heroes/${slug}/`, locale),
    openGraph: h.portrait ? { images: [`/${h.portrait}`] } : undefined,
  };
}

export async function HeroPage({ locale, params }: { locale: Locale } & Params) {
  const { slug } = await params;
  const heroes = readHeroes(locale);
  const hero = heroes.heroes.find((h) => h.slug === slug);
  if (!hero) notFound();
  const meta = readMeta();
  const maps = readMaps(locale);
  const min = meta.min_games_for_tier;
  // every region × bracket of the mode (owner 2026-10-02: the page filters by both, like the tier table)
  const model = (mode: Mode): HeroModeModel => {
    const { snap, fallback } = readShown(mode)!;
    const brackets: Bracket[] = mode === "sl" ? BRACKETS : ["all"];
    const cells: HeroModeModel["cells"] = {};
    const grid = {} as Record<Region, Record<Bracket, Snapshot | null>>;
    for (const r of REGIONS) {
      grid[r] = { all: null, low: null, high: null };
      for (const b of brackets) {
        const s = readShown(mode, b, r);
        grid[r][b] = s?.snap ?? null;
        cells[snapshotKey(mode, b, r)] = s ? { summary: heroSummary(s.snap, s.previous, hero.name, min), maps: mapRows(s.snap, hero.name, maps, min) } : null;
      }
    }
    return {
      patch: snap.patch,
      collectedAt: snap.collected_at,
      fallbackFrom: fallback ? meta.current_patch : null,
      cells,
      grid: heroGrid(mode, grid, hero.name, min),
    };
  };
  const builds = readBuilds();
  return (
    <HeroView
      hero={hero}
      models={{ qm: model("qm"), sl: model("sl") }}
      builds={heroBuilds(builds, readTalents(slug), hero.name, locale)}
      buildsPatch={builds?.patch ?? null}
      matchups={matchupsView(readMatchups(slug), heroes)}
      patches={heroPatchNotes(readPatchNotes(), hero.name, referencePatchId(meta), locale, readHotfixes())}
      minGames={min}
    />
  );
}

// --- 전장: every map in the pool, most Storm League matches first; computed at build time ---
export const mapsMetadata = (locale: Locale): Metadata => ({
  title: messages[locale].meta.mapsTitle,
  description: messages[locale].meta.mapsDescription,
  alternates: alternates("/hots/maps/", locale),
});

export function MapsPage({ locale }: { locale: Locale }) {
  const meta = readMeta();
  const { snap: sl, fallback } = readShown("sl")!; // same patch rule as every page (lib/shown.ts)
  const cards = mapCards(sl, readMaps(locale), readHeroes(locale), meta.min_games_for_tier, Infinity, { keepEmpty: true });
  return <MapsView cards={cards} patch={sl.patch} matches={sl.matches} collectedAt={sl.collected_at} fallbackFrom={fallback ? meta.current_patch : null} />;
}

// --- 전장 상세: one static page per map ---
export const mapParams = (): { slug: string }[] => readMaps(DEFAULT_LOCALE).maps.map((m) => ({ slug: m.slug }));

export async function mapMetadata(locale: Locale, { params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const m = readMaps(locale).maps.find((x) => x.slug === slug);
  if (!m) return {};
  return {
    title: m.ko,
    description: messages[locale].meta.mapDescription(m.ko, m.name),
    alternates: alternates(`/hots/maps/${slug}/`, locale),
    openGraph: m.image ? { images: [`/${m.image}`] } : undefined,
  };
}

export async function MapPage({ locale, params }: { locale: Locale } & Params) {
  const { slug } = await params;
  const map = readMaps(locale).maps.find((m) => m.slug === slug);
  if (!map) notFound();
  const meta = readMeta();
  const { snap: sl, fallback } = readShown("sl")!; // same patch rule as every page (lib/shown.ts)
  const min = meta.min_games_for_tier;
  return (
    <MapView
      map={map}
      info={readMapsMeta()?.maps[slug] ?? null}
      detail={mapDetail(sl, map.name, readHeroes(locale), min)}
      patch={sl.patch}
      collectedAt={sl.collected_at}
      fallbackFrom={fallback ? meta.current_patch : null}
      minGames={min}
    />
  );
}

// --- 전적 검색: a static shell; the search runs in the browser against our API (NEXT_PUBLIC_API_BASE) ---
export const playersMetadata = (locale: Locale): Metadata => ({
  title: messages[locale].meta.playersTitle,
  description: messages[locale].meta.playersDescription,
  alternates: alternates("/hots/players/", locale),
});

export function PlayersPage({ locale }: { locale: Locale }) {
  return <PlayerSearchView heroes={readHeroes(locale)} maps={readMaps(locale)} />;
}

// --- 밴픽: Storm League draft simulator; hero records at build time, the picked heroes' matchups fetched in the browser ---
export const draftMetadata = (locale: Locale): Metadata => ({
  title: messages[locale].meta.draftTitle,
  description: messages[locale].meta.draftDescription,
  alternates: alternates("/hots/draft/", locale),
});

export function DraftPage({ locale }: { locale: Locale }) {
  const table = readHeroes(locale);
  const shown = readShown("sl");
  const heroes = draftHeroes(shown?.snap ?? null, table).sort((a, b) => a.ko.localeCompare(b.ko, locale));
  return <DraftView heroes={heroes} maps={readMaps(locale).maps} roles={table.roles} patch={shown?.snap.patch ?? ""} />;
}

// --- 패치 요약: the reference patch's notes, hotfixes and new heroes, with each changed hero against the previous patch ---
export const patchesMetadata = (locale: Locale): Metadata => ({
  title: messages[locale].meta.patchesTitle,
  description: messages[locale].meta.patchesDescription,
  alternates: alternates("/hots/patches/", locale),
});

export function PatchesPage({ locale }: { locale: Locale }) {
  const meta = readMeta();
  const heroes = readHeroes(locale);
  const notes = readPatchNotes();
  const hotfixes = readHotfixes();
  const shown = (mode: Mode) => {
    const s = readShown(mode)!;
    return { snap: s.snap, previous: s.previous };
  };
  const model = patchSummary({ patch: referencePatchId(meta), notes, hotfixes, modes: { qm: shown("qm"), sl: shown("sl") }, heroes, minGames: meta.min_games_for_tier, locale });
  return <PatchesView model={model} collectedAt={meta.collected_at} />;
}
