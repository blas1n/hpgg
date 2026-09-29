/**
 * Languages and their URLs (#10). Every language, Korean included, lives under /<locale>/ (/ko/hots/…, /en/hots/…),
 * pre-rendered from one route tree (app/[locale]). Each page is one language from its first byte, so there is never a
 * flash of another; a stored choice (localStorage, when the browser allows it) is only a hint to redirect to the chosen
 * language's URL. The URLs before this (/hots/…) forward (scripts/forwarders.ts).
 */
import { DEFAULT_LOCALE, isLocale, LOCALE_KEY, LOCALES, SITE_URL, type Locale } from "./locales";

export { DEFAULT_LOCALE, isLocale, LOCALE_KEY, LOCALES, SITE_URL, type Locale };

const PREFIX = new RegExp(`^/(${LOCALES.join("|")})(?=/|$)`);

/** The language of a path, or null for a path outside the language tree (an old /hots/… URL). */
export const localeOfPath = (path: string): Locale | null => {
  const m = PREFIX.exec(path)?.[1];
  return isLocale(m) ? m : null;
};

/** A path without its language prefix: /en/hots/maps/ → /hots/maps/. */
export const sectionPath = (path: string): string => path.replace(PREFIX, "") || "/";

/** The same page in `to`: /hots/tier/, /ko/hots/tier/ or /en/hots/tier/ → /<to>/hots/tier/. */
export const localizedPath = (path: string, to: Locale): string => `/${to}${sectionPath(path)}`;

/** The next language in LOCALES — what the header switch offers. */
export const nextLocale = (l: Locale): Locale => LOCALES[(LOCALES.indexOf(l) + 1) % LOCALES.length]!;

/** Route params of app/[locale]: one pre-rendered tree per language. */
export const localeParams = (): { locale: Locale }[] => LOCALES.map((locale) => ({ locale }));

/** Page metadata: this language's canonical URL and one hreflang alternate per language (x-default = Korean). */
export function alternates(path: string, locale: Locale): { canonical: string; languages: Record<string, string> } {
  const url = (l: Locale) => SITE_URL + localizedPath(path, l);
  return { canonical: url(locale), languages: { ...Object.fromEntries(LOCALES.map((l) => [l, url(l)])), "x-default": url(DEFAULT_LOCALE) } };
}

type Get = () => Pick<Storage, "getItem"> | null | undefined;
type Put = () => Pick<Storage, "setItem"> | null | undefined;

/** The visitor's explicit choice; null when none (or storage is blocked). Never guessed from the browser language. */
export function readLocale(storage: Get): Locale | null {
  try {
    const v = storage()?.getItem(LOCALE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

/** Remember the choice; false when the browser refuses (the page the visitor chose still loads). */
export function writeLocale(locale: Locale, storage: Put): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(LOCALE_KEY, locale);
    return true;
  } catch {
    return false;
  }
}

/** The language switch: remember the choice, and if the browser refuses, drop any older choice rather than keep it
 *  (a stale hint would redirect the visitor away from the language they just picked). */
export function chooseLocale(locale: Locale, storage: () => Pick<Storage, "setItem" | "removeItem"> | null | undefined): boolean {
  if (writeLocale(locale, storage)) return true;
  try {
    storage()?.removeItem(LOCALE_KEY);
  } catch {
    // storage is blocked altogether: there is no stored hint either
  }
  return false;
}

/**
 * Runs inline in <head> before the body is parsed: when the visitor chose another language, go to this page in that
 * language before anything is painted (same query and hash). No choice = stay; the URL decides the language.
 * Arriving from another-language page of this site means the visitor switched (the switch is a plain link, so a click
 * before hydration skips its handler and leaves the old choice stored): record this page's language, never bounce.
 */
export const LOCALE_REDIRECT_SCRIPT = (locale: Locale): string =>
  `(function(){try{var L=${JSON.stringify(LOCALES)},K=${JSON.stringify(LOCALE_KEY)},H=${JSON.stringify(locale)},R=/^\\/(${LOCALES.join("|")})(?=\\/|$)/,r=document.referrer||"",o=location.origin+"/";if(r.indexOf(o)===0){var m=r.slice(o.length-1).match(R);if(m&&m[1]!==H)localStorage.setItem(K,H);return}var s=localStorage.getItem(K);if(L.indexOf(s)>=0&&s!==H){var p=location.pathname.replace(R,"")||"/";location.replace("/"+s+p+location.search+location.hash)}}catch(e){}})()`;
