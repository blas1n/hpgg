"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { assetUrl, hotsHref } from "@/data";
import type { SearchItem } from "@/lib/search";
import { HeroSearch } from "./HeroSearch";
import { ThemeToggle } from "./ThemeToggle";
import { cx } from "./ui";

const NAV = [
  { id: "home", href: hotsHref.home, label: "홈" },
  { id: "tier", href: hotsHref.tier(), label: "영웅 티어" },
  { id: "heroes", href: hotsHref.heroes, label: "영웅" },
  { id: "maps", href: hotsHref.maps, label: "전장" },
] as const;

function activeId(path: string): string {
  if (path.startsWith("/hots/tier")) return "tier";
  if (path.startsWith("/hots/heroes")) return "heroes";
  if (path.startsWith("/hots/maps")) return "maps";
  return "home";
}

/** Global header: brand + game, primary nav, hero search. Sticky; two rows on phones, one on desktop. */
export function SiteHeader({ searchIndex }: { searchIndex: SearchItem[] }) {
  const active = activeId(usePathname() ?? "/hots/");
  const ref = useRef<HTMLElement>(null);
  // --header-h lets sticky sub-navigation and anchor targets sit exactly under the header (it is two rows on phones)
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
      <div className="page-x flex h-14 items-center gap-3 md:gap-6">
        <a href={hotsHref.home} className="flex shrink-0 items-center gap-2" aria-label="hpgg.win 홈">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assetUrl("img/brand/icon-sm.png")} alt="" width={28} height={28} className="size-7 rounded-md" />
          <span className="text-xl font-extrabold tracking-tight text-fg">
            hpgg<span className="ml-px text-xs font-semibold text-primary">.win</span>
          </span>
        </a>
        <span className="hidden items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-fg-2 lg:inline-flex">
          <span className="size-1.5 rounded-full bg-primary" aria-hidden />
          Heroes of the Storm
        </span>
        <nav aria-label="주 메뉴" className="hidden h-14 items-stretch md:flex">
          {NAV.map((n) => (
            <NavLink key={n.id} {...n} active={active === n.id} />
          ))}
        </nav>
        <div className="ml-auto flex min-w-0 flex-1 justify-end">
          <HeroSearch items={searchIndex} id="site-search" />
        </div>
        <ThemeToggle />
      </div>
      <nav aria-label="주 메뉴 (모바일)" className="page-x scrollbar-none flex h-10 items-stretch overflow-x-auto border-t border-line md:hidden">
        {NAV.map((n) => (
          <NavLink key={n.id} {...n} active={active === n.id} />
        ))}
      </nav>
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
