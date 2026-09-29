"use client";

import { useState } from "react";
import { parseBattletag, playersHref, REGIONS, type Region } from "@/lib/players";
import { cx } from "../ui";

/** BattleTag + region. On 홈 it opens the 전적 검색 page; on that page `onSearch` runs the search in place. */
export function PlayerSearchForm({
  id = "player-search",
  initialTag = "",
  initialRegion = "KR",
  onSearch,
  className,
}: {
  id?: string;
  initialTag?: string;
  initialRegion?: Region;
  onSearch?: (tag: string, region: Region) => void;
  className?: string;
}) {
  const [tag, setTag] = useState(initialTag);
  const [region, setRegion] = useState<Region>(initialRegion);
  const [invalid, setInvalid] = useState(false);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = parseBattletag(tag);
    setInvalid(!parsed);
    if (!parsed) return;
    setTag(parsed);
    if (onSearch) onSearch(parsed, region);
    else window.location.assign(playersHref(parsed, region));
  };

  return (
    <form id={id} role="search" aria-label="전적 검색" action="/hots/players/" method="get" onSubmit={submit} className={className} noValidate>
      <div className={cx("flex h-11 items-stretch overflow-hidden rounded-lg border bg-surface-2 transition-colors focus-within:border-primary", invalid ? "border-neg" : "border-line")}>
        <label className="sr-only" htmlFor={`${id}-region`}>
          지역
        </label>
        <select
          id={`${id}-region`}
          name="region"
          value={region}
          onChange={(e) => setRegion(e.target.value as Region)}
          className="shrink-0 cursor-pointer border-r border-line bg-transparent pl-3 pr-1 text-[13px] font-semibold text-fg-2 outline-none"
        >
          {REGIONS.map((r) => (
            <option key={r.value} value={r.value} className="bg-surface-2">
              {r.label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor={`${id}-tag`}>
          배틀태그
        </label>
        <input
          id={`${id}-tag`}
          name="tag"
          value={tag}
          onChange={(e) => {
            setTag(e.target.value);
            if (invalid) setInvalid(false);
          }}
          placeholder="배틀태그 (이름#1234)"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : undefined}
          className="min-w-0 flex-1 bg-transparent px-3 text-sm text-fg outline-none placeholder:text-muted"
        />
        <button type="submit" className="shrink-0 bg-primary px-4 text-[13px] font-bold text-primary-ink transition-opacity hover:opacity-90">
          전적 검색
        </button>
      </div>
      {invalid && (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs text-neg">
          배틀태그를 이름#1234 형식으로 입력하세요.
        </p>
      )}
    </form>
  );
}
