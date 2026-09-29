"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useT } from "@/i18n/client";
import { THEME_COLOR, writeTheme, type Theme } from "@/lib/theme";

// the theme lives on <html data-theme> (set before paint by THEME_INIT_SCRIPT); React only mirrors it
const current = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
function subscribe(cb: () => void): () => void {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}

function apply(theme: Theme) {
  if (theme === "light") document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
}

/** Header button: navy ↔ light. Remembered when the browser allows storage, for this visit otherwise. */
export function ThemeToggle() {
  const t = useT();
  const theme = useSyncExternalStore(subscribe, current, () => "dark" as Theme);
  const light = theme === "light";
  // the init script may run before the theme-color meta exists; line the browser chrome up once mounted
  useEffect(() => apply(current()), []);
  return (
    <button
      type="button"
      id="theme-toggle"
      aria-pressed={light}
      aria-label={t.theme.label}
      title={light ? t.theme.toDark : t.theme.toLight}
      onClick={() => {
        const next: Theme = light ? "dark" : "light";
        apply(next);
        writeTheme(next, () => localStorage);
      }}
      className="grid size-9 shrink-0 place-items-center rounded-lg border border-line text-muted transition-colors hover:border-line-strong hover:text-fg"
    >
      {light ? (
        <svg aria-hidden viewBox="0 0 20 20" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="10" cy="10" r="3.5" />
          <path d="M10 2v1.5M10 16.5V18M2 10h1.5M16.5 10H18M4.3 4.3l1.1 1.1M14.6 14.6l1.1 1.1M4.3 15.7l1.1-1.1M14.6 5.4l1.1-1.1" />
        </svg>
      ) : (
        <svg aria-hidden viewBox="0 0 20 20" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
          <path d="M16.5 12.3A7 7 0 0 1 7.7 3.5a7 7 0 1 0 8.8 8.8Z" />
        </svg>
      )}
    </button>
  );
}
