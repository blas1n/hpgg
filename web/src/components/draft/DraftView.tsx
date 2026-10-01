"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHead } from "@/components/PageHead";
import { loadMatchups, type MatchupsFile } from "@/data";
import { useT } from "@/i18n/client";
import {
  applyPick,
  available,
  decodeDraft,
  draftState,
  encodeDraft,
  recommend,
  undo,
  type DraftHero,
  type Side,
} from "@/lib/draft";
import { filterHeroes } from "@/lib/heroes";
import { MATCHUP_K, MATCHUP_MIN_GAMES } from "@/lib/matchups";
import { Card, cx, Portrait, SELECT, Segmented } from "../ui";

const SUGGEST_TOP = 8;
const signed = (n: number): string =>
  (n > 0.05 ? "+" : n < -0.05 ? "" : "") +
  (Math.abs(n) < 0.05 ? "0.0" : n.toFixed(1));

export function DraftView({
  heroes,
  maps,
  roles,
  patch,
}: {
  heroes: DraftHero[];
  maps: { name: string; ko: string }[];
  roles: { name: string; ko: string }[];
  patch: string;
}) {
  const t = useT();
  const [usFirst, setUsFirst] = useState(true);
  const [map, setMap] = useState<string | null>(null);
  const [seq, setSeq] = useState<string[]>([]);
  const [role, setRole] = useState("all");
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<Map<string, MatchupsFile | null>>(
    new Map(),
  );
  const [copied, setCopied] = useState(false);
  const bySlug = useMemo(
    () => new Map(heroes.map((h) => [h.slug, h])),
    [heroes],
  );

  useEffect(() => {
    const d = decodeDraft(location.search, heroes);
    setUsFirst(d.usFirst);
    setMap(d.map && maps.some((m) => m.name === d.map) ? d.map : null);
    setSeq(d.seq);
  }, [heroes, maps]);

  const sync = (next: {
    usFirst: boolean;
    map: string | null;
    seq: string[];
  }) => {
    const qs = encodeDraft(next);
    history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : ""));
  };
  const update = (
    patch: Partial<{ usFirst: boolean; map: string | null; seq: string[] }>,
  ) => {
    const next = { usFirst, map, seq, ...patch };
    setUsFirst(next.usFirst);
    setMap(next.map);
    setSeq(next.seq);
    setCopied(false);
    sync(next);
  };

  const st = draftState(seq);
  const sideOf = (s: Side): "us" | "them" =>
    (s === "first") === usFirst ? "us" : "them";
  const team = (who: "us" | "them") =>
    st[(who === "us") === usFirst ? "first" : "second"];

  // matchups files of the picked heroes, loaded once each (null = not collected)
  const picked = [...st.first.picks, ...st.second.picks].filter((s) =>
    bySlug.has(s),
  );
  useEffect(() => {
    const want = picked.filter((s) => !files.has(s));
    if (!want.length) return;
    let live = true;
    void Promise.all(
      want.map(
        async (s) => [s, await loadMatchups(s, patch).catch(() => null)] as const,
      ),
    ).then((pairs) => {
      if (live) setFiles((f) => new Map([...f, ...pairs]));
    });
    return () => {
      live = false;
    };
  }, [picked.join("."), files]); // eslint-disable-line react-hooks/exhaustive-deps

  const loaded = useMemo(
    () =>
      new Map(
        [...files].filter((e): e is [string, MatchupsFile] => e[1] !== null),
      ),
    [files],
  );
  const loading = picked.some((s) => !files.has(s));
  const suggestions = useMemo(
    () =>
      recommend(heroes, seq, { matchups: loaded, map }).slice(0, SUGGEST_TOP),
    [heroes, seq, loaded, map],
  );
  const missing = picked.filter((s) => files.get(s) === null);
  const open = available(heroes, seq);
  const grid = filterHeroes(open, role, query);
  const next = st.next;
  const choGallBlocked =
    next?.kind === "pick" &&
    !open.some((h) => h.slug === "cho") &&
    !seq.includes("cho") &&
    !seq.includes("gall");

  const choose = (slug: string) => update({ seq: applyPick(seq, slug) });

  return (
    <main className="page-x mt-6 space-y-4 pb-10">
      <PageHead title={t.draft.title}>
        <p className="num mt-0.5 text-xs text-muted">
          {t.draft.metaLine(patch)}
        </p>
      </PageHead>

      <Card as="div" className="flex flex-wrap items-center gap-2 p-2.5">
        <Segmented
          label={t.draft.firstPick}
          idPrefix="draft-first"
          value={usFirst ? "us" : "them"}
          onChange={(v: "us" | "them") => update({ usFirst: v === "us" })}
          // fixed once the draft started: switching would move every hero to the other team
          disabled={seq.length > 0}
          options={[
            { value: "us", label: t.draft.usFirst },
            { value: "them", label: t.draft.themFirst },
          ]}
        />
        <label className="w-full sm:w-auto">
          <span className="sr-only">{t.draft.map}</span>
          <select
            id="draft-map"
            value={map ?? ""}
            onChange={(e) => update({ map: e.target.value || null })}
            className={SELECT}
          >
            <option value="">{t.draft.noMap}</option>
            {maps.map((m) => (
              <option key={m.name} value={m.name}>
                {m.ko}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-1.5 sm:ml-auto">
          <button
            id="draft-undo"
            type="button"
            disabled={!seq.length}
            onClick={() => update({ seq: undo(seq) })}
            className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-semibold text-fg-2 hover:text-fg disabled:opacity-40"
          >
            {t.draft.undo}
          </button>
          <button
            id="draft-reset"
            type="button"
            disabled={!seq.length}
            onClick={() => update({ seq: [] })}
            className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-semibold text-fg-2 hover:text-fg disabled:opacity-40"
          >
            {t.draft.reset}
          </button>
          <button
            id="draft-copy"
            type="button"
            onClick={() =>
              void navigator.clipboard?.writeText(location.href).then(
                () => setCopied(true),
                () => setCopied(false),
              )
            }
            className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-semibold text-fg-2 hover:text-fg"
          >
            {copied ? t.draft.copied : t.draft.copy}
          </button>
        </div>
      </Card>

      {/* phones: the two teams side by side, the turn and suggestions under them; desktop: teams either side */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,13rem)]">
        <TeamColumn
          who="us"
          label={t.draft.us}
          team={team("us")}
          active={next ? sideOf(next.side) : null}
          kind={next?.kind ?? null}
          bySlug={bySlug}
          className="order-1"
        />
        <TeamColumn
          who="them"
          label={t.draft.them}
          team={team("them")}
          active={next ? sideOf(next.side) : null}
          kind={next?.kind ?? null}
          bySlug={bySlug}
          className="order-2 lg:order-3"
        />

        <div className="order-3 col-span-2 min-w-0 space-y-3 lg:order-2 lg:col-span-1">
          <p
            id="draft-turn"
            aria-live="polite"
            className={cx(
              "rounded-lg px-3 py-2 text-center text-sm font-bold",
              next
                ? sideOf(next.side) === "us"
                  ? "bg-primary text-primary-ink"
                  : "border border-neg/60 bg-surface text-neg"
                : "bg-surface-2 text-fg-2",
            )}
          >
            {next
              ? t.draft.turn(
                  sideOf(next.side) === "us" ? t.draft.us : t.draft.them,
                  next.kind === "ban" ? t.draft.kindBan : t.draft.kindPick,
                )
              : t.draft.done}
          </p>

          {next && (
            <Card as="div" className="overflow-hidden">
              <div className="border-b border-line px-3 py-2">
                <h2
                  id="draft-suggest-title"
                  className="text-sm font-bold text-fg"
                >
                  {next.kind === "ban"
                    ? t.draft.suggestBan
                    : t.draft.suggestPick}
                </h2>
                <p className="text-2xs text-muted">
                  {next.kind === "ban"
                    ? t.draft.suggestBanSub
                    : t.draft.suggestPickSub}
                </p>
              </div>
              <ol
                id="draft-suggest"
                className={cx(
                  "divide-y divide-line/70",
                  loading && "opacity-60",
                )}
              >
                {suggestions.map((s) => (
                  <li key={s.hero.slug}>
                    <button
                      type="button"
                      data-hero={s.hero.slug}
                      onClick={() => choose(s.hero.slug)}
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-surface-2"
                    >
                      <Portrait
                        src={s.hero.portrait}
                        size={28}
                        role={s.hero.role || undefined}
                      />
                      <span className="min-w-0 flex-1 sm:flex sm:items-center sm:justify-between sm:gap-2">
                        <span className="block truncate text-[13px] font-semibold text-fg">
                          {s.hero.ko}
                        </span>
                        <span className="num flex flex-wrap gap-x-2 text-2xs text-muted">
                          {(["base", "allies", "enemies", "map"] as const).map(
                            (k) => (
                              <span key={k}>
                                {
                                  t.draft[
                                    `term${k[0]!.toUpperCase()}${k.slice(1)}` as "termBase"
                                  ]
                                }{" "}
                                <span data-term={k}>{signed(s.terms[k])}</span>
                              </span>
                            ),
                          )}
                        </span>
                      </span>
                      <span
                        data-score
                        className={cx(
                          "num w-12 text-right text-[13px] font-bold",
                          s.score >= 0 ? "text-fg" : "text-neg",
                        )}
                      >
                        {signed(s.score)}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              {(missing.length > 0 || loading) && (
                <p
                  id="draft-missing"
                  className="border-t border-line px-3 py-1.5 text-2xs text-muted"
                >
                  {loading
                    ? t.draft.loading
                    : t.draft.missing(
                        missing.map((s) => bySlug.get(s)?.ko ?? s).join(", "),
                      )}
                </p>
              )}
            </Card>
          )}

          {next && (
            <Card as="div" className="space-y-2 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <div
                  role="group"
                  aria-label={t.common.role}
                  className="scrollbar-none flex max-w-full gap-0.5 overflow-x-auto"
                >
                  {[{ name: "all", ko: t.common.allRoles }, ...roles].map(
                    (r) => (
                      <button
                        key={r.name}
                        type="button"
                        data-role={r.name}
                        aria-pressed={role === r.name}
                        onClick={() => setRole(r.name)}
                        className={cx(
                          "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-semibold transition-colors",
                          role === r.name
                            ? "bg-surface-3 text-fg"
                            : "text-muted hover:text-fg",
                        )}
                      >
                        {r.ko}
                      </button>
                    ),
                  )}
                </div>
                <label className="w-full lg:ml-auto lg:w-48">
                  <span className="sr-only">{t.common.heroSearch}</span>
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t.heroes.searchPlaceholder}
                    autoComplete="off"
                    className="w-full rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-[13px] text-fg placeholder:text-muted"
                  />
                </label>
              </div>
              <div
                id="draft-heroes"
                className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5"
              >
                {grid.map((h) => (
                  <button
                    key={h.slug}
                    type="button"
                    data-hero={h.slug}
                    onClick={() => choose(h.slug)}
                    className="flex flex-col items-center gap-1 rounded-lg border border-line bg-surface p-1.5 hover:border-primary"
                  >
                    <Portrait
                      src={h.portrait}
                      size={40}
                      role={h.role || undefined}
                    />
                    <span className="w-full truncate text-center text-2xs font-semibold text-fg">
                      {h.ko}
                    </span>
                  </button>
                ))}
              </div>
              {choGallBlocked && (
                <p className="text-2xs text-muted">{t.draft.choGall}</p>
              )}
            </Card>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <p
          id="draft-rule"
          className="max-w-[80ch] rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs break-keep text-fg-2"
        >
          {t.draft.rule(String(MATCHUP_K), String(MATCHUP_MIN_GAMES))}
        </p>
        <p className="text-2xs text-muted">{t.draft.orderSource}</p>
      </div>
    </main>
  );
}

function TeamColumn({
  who,
  label,
  team,
  active,
  kind,
  bySlug,
  className,
}: {
  who: "us" | "them";
  label: string;
  team: { bans: string[]; picks: string[] };
  active: "us" | "them" | null;
  kind: "ban" | "pick" | null;
  bySlug: Map<string, DraftHero>;
  className?: string;
}) {
  const t = useT();
  const here = active === who;
  const cell = (k: "ban" | "pick", i: number, list: string[], size: number) => {
    const slug = list[i];
    const h = slug ? bySlug.get(slug) : undefined;
    const isNext = here && kind === k && i === list.length;
    return (
      <div
        key={i}
        data-slot={`${who}-${k}-${i + 1}`}
        data-hero={slug ?? undefined}
        className={cx(
          "flex items-center gap-2 rounded-lg border p-1",
          isNext ? "border-primary bg-primary/10" : "border-line bg-surface",
        )}
      >
        {h ? (
          <Portrait
            src={h.portrait}
            size={size}
            role={h.role || undefined}
            className={k === "ban" ? "opacity-50 grayscale" : undefined}
          />
        ) : (
          <span
            className="inline-block rounded-md bg-surface-2"
            style={{ width: size, height: size }}
          />
        )}
        {k === "pick" && (
          <span className="min-w-0 truncate text-[13px] font-semibold text-fg">
            {h?.ko ?? ""}
          </span>
        )}
      </div>
    );
  };
  return (
    <Card as="div" className={cx("min-w-0 space-y-2 p-2.5", className)}>
      <h2
        className={cx(
          "text-sm font-bold",
          who === "us" ? "text-primary" : "text-neg",
        )}
      >
        {label}
      </h2>
      <div>
        <p className="mb-1 text-2xs text-muted">{t.draft.bans}</p>
        <div className="grid grid-cols-3 gap-1">
          {[0, 1, 2].map((i) => cell("ban", i, team.bans, 28))}
        </div>
      </div>
      <div>
        <p className="mb-1 text-2xs text-muted">{t.draft.picks}</p>
        <div className="space-y-1">
          {[0, 1, 2, 3, 4].map((i) => cell("pick", i, team.picks, 32))}
        </div>
      </div>
    </Card>
  );
}
