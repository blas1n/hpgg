/**
 * Features of the live site that can be switched off without deleting their code. The site is a static export, so a
 * switch takes effect with the next build (a one-line PR, deployed on merge); nothing switches at runtime.
 * A switched-off section is left out of the menu (SiteHeader), the sitemap (scripts/sitemap.ts) and the export
 * (scripts/prune-features.ts — GitHub Pages then answers 404); `next dev` still serves it, so it can be worked on.
 * Runs under Node (type stripping) and in vitest.
 */
export const FEATURES = {
  /** 밴픽 시뮬레이터 — off 2026-10-02 (owner): it sorts by score with a matchup correction and ignores the roles a
   *  team needs (tank, healer…); back once the suggestions account for them. */
  draft: false,
} as const;

export type Feature = keyof typeof FEATURES;
export type Flags = Record<Feature, boolean>;

/** The section under /<locale>/hots/ each feature owns. */
const SECTION_OF: Record<Feature, string> = { draft: "draft" };

export const sectionEnabled = (section: string, flags: Flags = FEATURES): boolean =>
  (Object.keys(SECTION_OF) as Feature[]).every((f) => SECTION_OF[f] !== section || flags[f]);

/** Sections of switched-off features (the export drops them). */
export const disabledSections = (flags: Flags = FEATURES): string[] =>
  (Object.keys(SECTION_OF) as Feature[]).filter((f) => !flags[f]).map((f) => SECTION_OF[f]);

const NAV_IDS = ["home", "tier", "heroes", "draft", "maps", "players"] as const;
export type NavId = (typeof NAV_IDS)[number];

/** The header menu, in order, without switched-off sections. */
export const navIds = (flags: Flags = FEATURES): NavId[] => NAV_IDS.filter((id) => id === "home" || sectionEnabled(id, flags));
