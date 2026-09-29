/**
 * Languages and their URLs (#10). Korean is the default and keeps the live URLs (/hots/…); English is pre-rendered
 * under /en (/en/hots/…). Each page is one language from its first byte, so there is never a flash of the other one;
 * a stored choice (localStorage, when the browser allows it) is only a hint to redirect to the chosen language's URL.
 */
export type Locale = "ko" | "en";
export const LOCALES: Locale[] = ["ko", "en"];
export const DEFAULT_LOCALE: Locale = "ko";
export const SITE_URL = "https://hpgg.win";
export const LOCALE_KEY = "hpgg-locale";
/** Open Graph locale per language. */
export const OG_LOCALE: Record<Locale, string> = { ko: "ko_KR", en: "en_US" };
/** Number formatting per language (grouping only; both print 1,234). */
export const NUMBER_LOCALE: Record<Locale, string> = { ko: "ko-KR", en: "en-US" };

const EN_PREFIX = /^\/en(?=\/|$)/;

export const localeOfPath = (path: string): Locale => (EN_PREFIX.test(path) ? "en" : "ko");
export const otherLocale = (l: Locale): Locale => (l === "ko" ? "en" : "ko");

/** The same page in `to`: /hots/tier/ ⇄ /en/hots/tier/. */
export function localizedPath(path: string, to: Locale): string {
  const base = path.replace(EN_PREFIX, "") || "/";
  return to === "ko" ? base : `/en${base}`;
}

/** Page metadata: this language's canonical URL and the hreflang alternates (x-default = Korean). `koPath` = the Korean URL path. */
export function alternates(koPath: string, locale: Locale): { canonical: string; languages: Record<"ko" | "en" | "x-default", string> } {
  const url = (l: Locale) => SITE_URL + localizedPath(koPath, l);
  return { canonical: url(locale), languages: { ko: url("ko"), en: url("en"), "x-default": url("ko") } };
}

type Get = () => Pick<Storage, "getItem"> | null | undefined;
type Put = () => Pick<Storage, "setItem"> | null | undefined;

/** The visitor's explicit choice; null when none (or storage is blocked). Never guessed from the browser language. */
export function readLocale(storage: Get): Locale | null {
  try {
    const v = storage()?.getItem(LOCALE_KEY);
    return v === "ko" || v === "en" ? v : null;
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

/**
 * Runs inline in <head> before the body is parsed: when the visitor chose the other language, go to this page in that
 * language before anything is painted (same query and hash). No choice = stay; the URL decides the language.
 */
export const LOCALE_REDIRECT_SCRIPT = (locale: Locale): string =>
  `(function(){try{var s=localStorage.getItem(${JSON.stringify(LOCALE_KEY)});if((s==="ko"||s==="en")&&s!==${JSON.stringify(locale)}){var p=location.pathname.replace(/^\\/en(?=\\/|$)/,"")||"/";location.replace((s==="en"?"/en"+p:p)+location.search+location.hash)}}catch(e){}})()`;
