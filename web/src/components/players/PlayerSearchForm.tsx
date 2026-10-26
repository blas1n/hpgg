"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useT } from "@/i18n/client";
import { localizedPath } from "@/i18n/locale";
import { isRegion, parseBattletag, playersHref, REGIONS, rememberRegion, startRegion, type Region } from "@/lib/players";
import { cx } from "../ui";

/** BattleTag + region. On 홈 it opens the 전적 검색 page; on that page `onSearch` runs the search in place. */
export function PlayerSearchForm({
  id = "player-search",
  initialTag = "",
  initialRegion,
  onSearch,
  className,
}: {
  id?: string;
  initialTag?: string;
  /** none: the visitor's region — chosen before, else the time zone, else the page language (lib/players.ts) */
  initialRegion?: Region;
  onSearch?: (tag: string, region: Region) => void;
  className?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const [tag, setTag] = useState(initialTag);
  // the static page renders the language's default; the visitor's own region is set once in the browser
  const rendered: Region = initialRegion ?? (locale === "ko" ? "KR" : "NA");
  const [region, setRegion] = useState<Region>(rendered);
  const [ready, setReady] = useState(false); // data-ready: hydrated and on its start region
  // a region picked on the static page before the scripts ran is in the menu only until hydration resets it:
  // read it on the first client render, while it is still there (CI 2026-10-26: KR picked, the search went on EU)
  const early = useRef<Region | null | undefined>(undefined);
  if (early.current === undefined) early.current = pickedBeforeHydration(`${id}-region`, rendered);
  useEffect(() => {
    hydrated = true;
    if (early.current) setRegion(early.current);
    else if (!initialRegion) setRegion(startRegion(locale));
    setReady(true);
  }, [initialRegion, locale]);
  const [invalid, setInvalid] = useState(false);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = parseBattletag(tag);
    setInvalid(!parsed);
    if (!parsed) return;
    setTag(parsed);
    rememberRegion(region);
    if (onSearch) onSearch(parsed, region);
    else window.location.assign(playersHref(locale, parsed, region));
  };

  return (
    <form id={id} data-ready={ready || undefined} role="search" aria-label={t.players.formLabel} action={localizedPath("/hots/players/", locale)} method="get" onSubmit={submit} className={className} noValidate>
      <div className={cx("flex h-11 items-stretch overflow-hidden rounded-lg border bg-surface-2 transition-colors focus-within:border-primary", invalid ? "border-neg" : "border-line")}>
        <label className="sr-only" htmlFor={`${id}-region`}>
          {t.players.region}
        </label>
        <select
          id={`${id}-region`}
          name="region"
          value={region}
          onChange={(e) => setRegion(e.target.value as Region)}
          className="shrink-0 cursor-pointer border-r border-line bg-transparent pl-3 pr-1 text-[13px] font-semibold text-fg-2 outline-none"
        >
          {REGIONS.map((r) => (
            <option key={r} value={r} className="bg-surface-2">
              {t.players.regions[r]}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor={`${id}-tag`}>
          {t.players.battletag}
        </label>
        <input
          id={`${id}-tag`}
          name="tag"
          value={tag}
          onChange={(e) => {
            setTag(e.target.value);
            if (invalid) setInvalid(false);
          }}
          placeholder={t.players.placeholder}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : undefined}
          className="min-w-0 flex-1 bg-transparent px-3 text-sm text-fg outline-none placeholder:text-muted"
        />
        <button type="submit" className="shrink-0 bg-primary px-4 text-[13px] font-bold text-primary-ink transition-opacity hover:opacity-90">
          {t.players.submit}
        </button>
      </div>
      {invalid && (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs text-neg">
          {t.players.invalidTag}
        </p>
      )}
    </form>
  );
}

// set once the page's first form has mounted: a form mounted later (a shared link's search remounts it) finds the
// previous form's menu in the document, which is not a pick made before hydration
let hydrated = false;

/** The menu's value when it differs from what the static page rendered: the visitor picked it before hydration. */
function pickedBeforeHydration(selectId: string, rendered: Region): Region | null {
  if (hydrated || typeof document === "undefined") return null;
  const v = (document.getElementById(selectId) as HTMLSelectElement | null)?.value;
  return isRegion(v) && v !== rendered ? v : null;
}
