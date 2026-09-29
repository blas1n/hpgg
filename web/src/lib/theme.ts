/**
 * Colour theme. Navy ("dark") is the brand default; "light" is opt-in from the header toggle.
 * The system's prefers-color-scheme is deliberately not followed: the navy look is the site's identity (owner,
 * issue #1), so a visitor sees light only after choosing it. The choice is remembered in localStorage when the
 * browser allows it, and for the visit otherwise.
 */
export type Theme = "dark" | "light";

export const THEME_KEY = "hpgg-theme";
export const DEFAULT_THEME: Theme = "dark";
/** Browser chrome colour (meta theme-color) per theme: the page background. */
export const THEME_COLOR: Record<Theme, string> = { dark: "#0e1118", light: "#f3f5f9" };

type Get = () => Pick<Storage, "getItem"> | null | undefined;
type Put = () => Pick<Storage, "setItem"> | null | undefined;

/** Stored choice, or the default. Reading storage can throw (private windows, blocked site data). */
export function readTheme(storage: Get): Theme {
  try {
    return storage()?.getItem(THEME_KEY) === "light" ? "light" : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Remember the choice; false when the browser refuses (the theme still applies for this visit). */
export function writeTheme(theme: Theme, storage: Put): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(THEME_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs inline in <head> before the body is parsed, so a light choice paints light from the first frame
 * (a static export has no server to render the right theme). Dark needs nothing: it is the stylesheet's default.
 */
export const THEME_INIT_SCRIPT = `(function(){try{if(localStorage.getItem(${JSON.stringify(THEME_KEY)})==="light"){document.documentElement.dataset.theme="light";var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",${JSON.stringify(THEME_COLOR.light)})}}catch(e){}})()`;
