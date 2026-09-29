"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { hotsHref } from "@/data";
import { useLocale, useT } from "@/i18n/client";
import { searchHeroes, type SearchItem } from "@/lib/search";
import { cx, Portrait, TierBadge } from "./ui";

/** Hero search combobox: Korean, English and 초성 queries; ↑↓ Enter Esc; "/" focuses the header box. */
export function HeroSearch({ items, id }: { items: SearchItem[]; id?: string }) {
  const t = useT();
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const listId = useId();
  const results = useMemo(() => searchHeroes(items, query, 8), [items, query]);

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

  const go = (item: SearchItem | undefined) => {
    if (!item) return;
    setOpen(false);
    window.location.assign(hotsHref(locale).hero(item.slug));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[active] ?? results[0]);
    } else if (e.key === "Escape") {
      setOpen(false);
      input.current?.blur();
    }
  };

  const showList = open && query.trim().length > 0;

  return (
    <div ref={wrap} className="relative w-full max-w-sm">
      <label className="sr-only" htmlFor={id ?? `${listId}-input`}>
        {t.search.label}
      </label>
      <div
        className="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 transition-colors focus-within:border-primary"
      >
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
          aria-activedescendant={showList && results[active] ? `${listId}-opt-${active}` : undefined}
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
          className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
        />
        <kbd className="hidden rounded border border-line px-1.5 text-2xs text-muted sm:inline" aria-hidden>
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
          {results.length === 0 && <li className="px-3 py-3 text-[13px] text-muted">{t.search.none(query.trim())}</li>}
          {results.map((r, i) => (
            <li
              key={r.slug}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              data-hero={r.slug}
              onPointerEnter={() => setActive(i)}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => go(r)}
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
        </ul>
      )}
    </div>
  );
}
