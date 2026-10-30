"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { hotsHref } from "@/data";
import { useLocale, useT } from "@/i18n/client";
import { startRegion, type Region } from "@/lib/players";
import { unifiedSearch, type SearchItem } from "@/lib/search";
import { cx, Portrait, TierBadge } from "./ui";

/** The header box (design B · 검색 중심): a hero (Korean, English, 초성) or a BattleTag (→ 전적 검색 on the visitor's
 *  region, the same rule the player search starts with). ↑↓ Enter Esc; "/" focuses it. */
export function SiteSearch({ items, id }: { items: SearchItem[]; id?: string }) {
  const t = useT();
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const listId = useId();
  // the region is read in the browser only, once there is something typed (the static page renders an empty box)
  const region: Region = useMemo(() => (query.trim() ? startRegion(locale) : locale === "ko" ? "KR" : "NA"), [query, locale]);
  const { heroes, player, hint } = useMemo(() => unifiedSearch(items, query, { locale, region }, 8), [items, query, locale, region]);
  const count = player ? 1 : heroes.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || t?.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const go = (i: number) => {
    const href = player ? player.href : heroes[i] ? hotsHref(locale).hero(heroes[i].slug) : null;
    if (!href) return;
    setOpen(false);
    window.location.assign(href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, count - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(active < count ? active : 0);
    } else if (e.key === "Escape") {
      setOpen(false);
      input.current?.blur();
    }
  };

  const showList = open && query.trim().length > 0;
  const optId = (i: number) => `${listId}-opt-${i}`;

  return (
    <div ref={wrap} className="relative w-full">
      <label className="sr-only" htmlFor={id ?? `${listId}-input`}>
        {t.search.label}
      </label>
      <div className="flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3 transition-colors focus-within:border-primary hover:border-line-strong">
        <svg aria-hidden viewBox="0 0 20 20" className="size-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="9" cy="9" r="6" />
          <path d="M14 14l4 4" />
        </svg>
        <input
          ref={input}
          id={id ?? `${listId}-input`}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={`${listId}-list`}
          aria-autocomplete="list"
          aria-activedescendant={showList && active < count ? optId(active) : undefined}
          autoComplete="off"
          spellCheck={false}
          value={query}
          placeholder={t.search.placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
        />
        <kbd className="hidden rounded border border-line px-1.5 text-2xs text-muted md:inline" aria-hidden>
          /
        </kbd>
      </div>
      {showList && (
        <ul
          id={`${listId}-list`}
          role="listbox"
          aria-label={t.search.results}
          className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-96 overflow-auto rounded-lg border border-line-strong bg-surface-2 py-1 shadow-2xl shadow-black/50"
        >
          {player && (
            <>
              <li role="presentation" className="px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wide text-muted">
                {t.search.playerGroup}
              </li>
              <li
                id={optId(0)}
                role="option"
                aria-selected={active === 0}
                data-player={player.tag}
                onPointerEnter={() => setActive(0)}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => go(0)}
                className={cx("flex cursor-pointer items-center gap-3 px-3 py-2", active === 0 && "bg-surface-3")}
              >
                <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md border border-line bg-surface text-muted">
                  <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="10" cy="7" r="3.2" />
                    <path d="M3.5 17c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg">
                  {player.tag} <span className="font-normal text-muted">· {t.players.regions[player.region]}</span>
                </span>
              </li>
            </>
          )}
          {!player && heroes.length === 0 && !/[#＃]/.test(query) && <li className="px-3 py-3 text-[13px] text-muted">{t.search.none(query.trim())}</li>}
          {heroes.map((r, i) => (
            <li
              key={r.slug}
              id={optId(i)}
              role="option"
              aria-selected={i === active}
              data-hero={r.slug}
              onPointerEnter={() => setActive(i)}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => go(i)}
              className={cx("flex cursor-pointer items-center gap-3 px-3 py-2", i === active && "bg-surface-3")}
            >
              <Portrait src={r.portrait} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-fg">{r.ko}</span>
                <span className="block truncate text-2xs text-muted">
                  {r.name} · {r.role_ko}
                </span>
              </span>
              {r.tier && <TierBadge tier={r.tier} size="sm" />}
            </li>
          ))}
          {hint && (
            <li role="presentation" data-hint className="border-t border-line px-3 pb-1.5 pt-2 text-2xs text-muted">
              {t.search.tagHint}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
