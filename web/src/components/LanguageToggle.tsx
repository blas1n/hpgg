"use client";

import { usePathname } from "next/navigation";
import { useLocale } from "@/i18n/client";
import { chooseLocale, localizedPath, otherLocale } from "@/i18n/locale";
import { messages } from "@/i18n/messages";

/**
 * Header switch to the same page in the other language (#10): a plain link (works without JS, crawlable), labelled in
 * the language it leads to. A click also remembers the choice (a redirect hint for later visits, i18n/locale.ts) and
 * carries the page's query and hash, so the view on screen (mode, map, section) stays the same.
 */
export function LanguageToggle() {
  const to = otherLocale(useLocale());
  const target = messages[to].lang;
  const href = localizedPath(usePathname() ?? "/hots/", to);
  return (
    <a
      id="lang-toggle"
      href={href}
      hrefLang={to}
      lang={to}
      aria-label={target.switchLabel}
      title={target.switchLabel}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // a new tab keeps the plain link
        e.preventDefault();
        chooseLocale(to, () => localStorage);
        location.assign(localizedPath(location.pathname, to) + location.search + location.hash);
      }}
      className="grid h-9 min-w-9 shrink-0 place-items-center rounded-lg border border-line px-2 text-xs font-bold text-muted transition-colors hover:border-line-strong hover:text-fg"
    >
      {target.short}
    </a>
  );
}
