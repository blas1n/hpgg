/**
 * The site's languages — the one list (#10). Every page is pre-rendered once per entry under /<locale>/ (app/[locale]),
 * and the old-URL forwarders and the pre-paint redirect hint read it too. Adding a language: add it here, add its
 * message table (src/i18n/<locale>.ts, registered in messages.ts) and its data fields (names: `<locale>` next to `ko`).
 * The first entry is the default (Korean). Plain TS with no imports: scripts/forwarders.ts loads it under Node too.
 */
export const LOCALES = ["ko", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = LOCALES[0];
/** localStorage key of the visitor's explicit choice (a redirect hint only). */
export const LOCALE_KEY = "hpgg-locale";
export const SITE_URL = "https://hpgg.win";
export const isLocale = (s: unknown): s is Locale => (LOCALES as readonly unknown[]).includes(s);
