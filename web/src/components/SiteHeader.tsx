"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { assetUrl, hotsHref } from "@/data";
import { useLocale, useT } from "@/i18n/client";
import { sectionPath } from "@/i18n/locale";
import { FEATURES, navIds, type NavId } from "@/features";
import type { SearchItem } from "@/lib/search";
import { AccountMenu } from "./AccountMenu";
import { LanguageToggle } from "./LanguageToggle";
import { SiteSearch } from "./SiteSearch";
import { ThemeToggle } from "./ThemeToggle";
import { cx } from "./ui";


function activeId(path: string): NavId | null {
  const p = sectionPath(path); // the section is the same in every language
  if (p.startsWith("/hots/tier")) return "tier";
  if (p.startsWith("/hots/heroes")) return "heroes";
  if (p.startsWith("/hots/maps")) return "maps";
  if (p.startsWith("/hots/players")) return "players";
  if (p.startsWith("/hots/patches")) return "patches";
  if (p.startsWith("/hots/meta")) return "meta";
  if (p.startsWith("/hots/draft")) return "draft";
  return null; // 홈: the logo is home, there is no tab for it
}

/** Global header, design B · 검색 중심 (owner 2026-10-30). Desktop: logo · one search box (hero or BattleTag) centred ·
 *  language and theme; the section tabs below. Phones: logo and toggles, the search at full width, scrolling tabs. */
export function SiteHeader({ searchIndex }: { searchIndex: SearchItem[] }) {
  const t = useT();
  const href = hotsHref(useLocale());
  const nav = navIds().map((id) => ({ id, href: id === "tier" ? href.tier() : id === "draft" ? href.draft() : id === "meta" ? href.meta() : href[id], label: t.nav[id] }));
  const active = activeId(usePathname() ?? "/hots/");
  const ref = useRef<HTMLElement>(null);
  // --header-h lets sticky sub-navigation and anchor targets sit exactly under the header (three rows on phones)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty("--header-h", `${el.getBoundingClientRect().height}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <header ref={ref} className="sticky top-0 z-40 border-b border-line bg-surface-2/95 backdrop-blur supports-[backdrop-filter]:bg-surface-2/80">
      <div className="page-x grid grid-cols-[1fr_auto] grid-rows-[48px_auto] items-center gap-x-4 md:grid-cols-[1fr_minmax(0,560px)_1fr] md:grid-rows-[56px]">
        <a href={href.home} className="col-start-1 row-start-1 flex shrink-0 items-center gap-2 justify-self-start" aria-label={t.nav.homeLink}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assetUrl("img/brand/icon-sm.png")} alt="" width={28} height={28} className="size-7 rounded-md" />
          <span className="text-xl font-extrabold tracking-tight text-fg">
            hpgg<span className="ml-px text-xs font-semibold text-primary">.win</span>
          </span>
        </a>
        <div className="col-span-2 col-start-1 row-start-2 pb-2.5 md:col-span-1 md:col-start-2 md:row-start-1 md:pb-0">
          <SiteSearch items={searchIndex} id="site-search" />
        </div>
        <div className="col-start-2 row-start-1 flex items-center gap-1.5 justify-self-end md:col-start-3">
          <LanguageToggle />
          <ThemeToggle />
          {FEATURES.accounts && <AccountMenu />}
        </div>
      </div>
      <div className="page-x">
        <nav aria-label={t.nav.main} className="scrollbar-none -mx-4 flex h-10 items-stretch overflow-x-auto px-1 md:mx-0 md:-ml-3 md:px-0">
          {nav.map((n) => (
            <NavLink key={n.id} {...n} active={active === n.id} />
          ))}
        </nav>
      </div>
    </header>
  );
}

function NavLink({ id, href, label, active }: { id: string; href: string; label: string; active: boolean }) {
  return (
    <a
      href={href}
      data-page={id}
      aria-current={active ? "page" : undefined}
      className={cx(
        "relative inline-flex items-center whitespace-nowrap px-3 text-sm font-semibold transition-colors",
        active ? "text-fg after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary" : "text-muted hover:text-fg",
      )}
    >
      {label}
    </a>
  );
}
