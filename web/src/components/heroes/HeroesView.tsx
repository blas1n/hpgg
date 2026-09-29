"use client";

import { useEffect, useState } from "react";
import { hotsHref, MODE_LABEL, type Mode } from "@/data";
import { filterHeroes } from "@/lib/heroes";
import type { SearchItem } from "@/lib/search";
import { Card, cx, Portrait, Segmented } from "../ui";

export function HeroesView({ heroes, roles, tiers, patches }: { heroes: SearchItem[]; roles: { name: string; ko: string }[]; tiers: Record<Mode, Record<string, string>>; patches: Record<Mode, string> }) {
  const [mode, setMode] = useState<Mode>("qm");
  const [role, setRole] = useState("all");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.get("mode") === "sl") setMode("sl");
    const r = q.get("role");
    if (r && roles.some((x) => x.name === r)) setRole(r);
  }, [roles]);
  const sync = (m: Mode, r: string) => {
    const q = new URLSearchParams();
    if (m !== "qm") q.set("mode", m);
    if (r !== "all") q.set("role", r);
    history.replaceState(null, "", location.pathname + (q.size ? `?${q}` : ""));
  };
  const list = filterHeroes(heroes, role, query);

  return (
    <main className="page-x mt-6 space-y-4 pb-10">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-fg">영웅</h1>
        <p id="meta-line" className="num mt-0.5 text-xs text-muted">
          {MODE_LABEL[mode]} 티어 · 패치 {patches[mode]} · 누르면 상세로
        </p>
      </div>

      <Card as="div" className="flex flex-wrap items-center gap-2 p-2.5">
        <Segmented
          label="게임 모드"
          idPrefix="mode"
          value={mode}
          onChange={(m: Mode) => {
            setMode(m);
            sync(m, role);
          }}
          options={[
            { value: "qm", label: MODE_LABEL.qm },
            { value: "sl", label: MODE_LABEL.sl },
          ]}
        />
        <div id="roles" role="group" aria-label="역할" className="scrollbar-none flex max-w-full gap-0.5 overflow-x-auto">
          {[{ name: "all", ko: "전체" }, ...roles].map((r) => (
            <button
              key={r.name}
              type="button"
              data-role={r.name}
              aria-pressed={role === r.name}
              onClick={() => {
                setRole(r.name);
                sync(mode, r.name);
              }}
              className={cx("shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-semibold transition-colors", role === r.name ? "bg-surface-3 text-fg" : "text-muted hover:text-fg")}
            >
              {r.ko}
            </button>
          ))}
        </div>
        <label className="w-full lg:ml-auto lg:w-60">
          <span className="sr-only">영웅 검색</span>
          <input
            id="search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름 · 영문 · 초성 (ㅇㄹㄷ)"
            autoComplete="off"
            className="w-full rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-[13px] text-fg placeholder:text-muted"
          />
        </label>
      </Card>

      <div id="grid" className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(104px,1fr))]">
        {list.map((h) => (
          <a
            key={h.slug}
            href={hotsHref.hero(h.slug, mode)}
            data-hero={h.slug}
            data-tier={tiers[mode][h.slug] ?? ""}
            className="group flex flex-col items-center gap-1.5 rounded-card border border-line bg-surface px-1 pb-2 pt-3 transition-colors hover:border-primary"
          >
            <Portrait src={h.portrait} size={56} tier={tiers[mode][h.slug]} role={h.role} />
            <span className="w-full truncate text-center text-xs font-bold text-fg group-hover:text-primary">{h.ko}</span>
            <span className="text-2xs text-muted">{h.role_ko}</span>
          </a>
        ))}
      </div>
      {list.length === 0 && <p className="py-10 text-center text-[13px] text-muted">맞는 영웅이 없습니다</p>}
    </main>
  );
}
