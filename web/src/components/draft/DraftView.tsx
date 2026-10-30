"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHead } from "@/components/PageHead";
import { loadMatchups, type MatchupsFile } from "@/data";
import { FEATURES } from "@/features";
import { useLocale, useT } from "@/i18n/client";
import {
  applyPick,
  available,
  decodeDraft,
  draftRule,
  draftState,
  encodeDraft,
  recommend,
  undo,
  type DraftHero,
  type Side,
} from "@/lib/draft";
import type { CompModel } from "@/lib/comps";
import { filterHeroes } from "@/lib/heroes";
import { fetchMe, loginUrl, type Me } from "@/lib/account";
import { getPool, onlyPool, readOnlyPool, readTab, withTab, writeOnlyPool, type DraftTab } from "@/lib/pool";
import { Card, cx, Portrait, SELECT, Segmented } from "../ui";
import { HeroPool, type PoolSource } from "./HeroPool";

const SUGGEST_TOP = 8;
const signed = (n: number): string =>
  (n > 0.05 ? "+" : n < -0.05 ? "" : "") +
  (Math.abs(n) < 0.05 ? "0.0" : n.toFixed(1));

export function DraftView({
  heroes,
  maps,
  roles,
  patch,
  comps,
}: {
  heroes: DraftHero[];
  maps: { name: string; ko: string }[];
  roles: { name: string; ko: string }[];
  patch: string;
  /** Team composition model (lib/comps.ts); null before the first collection: the term is 0. */
  comps: CompModel | null;
}) {
  const t = useT();
  const locale = useLocale();
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
  // 내 영웅풀 (#28, stage D): members only, and nothing is asked of the API while accounts are switched off
  const [me, setMe] = useState<Me | null | "loading">(FEATURES.accounts ? "loading" : null);
  const [pool, setPool] = useState<string[] | null>(null);
  const [poolFailed, setPoolFailed] = useState(false);
  const [sources, setSources] = useState<Record<string, PoolSource>>({});
  const [tab, setTab] = useState<DraftTab>("draft");
  const [only, setOnly] = useState(false);
  const member = FEATURES.accounts && me !== null && me !== "loading";
  const view: DraftTab = member ? tab : "draft";

  useEffect(() => {
    const d = decodeDraft(location.search, heroes);
    setUsFirst(d.usFirst);
    setMap(d.map && maps.some((m) => m.name === d.map) ? d.map : null);
    setSeq(d.seq);
  }, [heroes, maps]);

  useEffect(() => {
    if (!FEATURES.accounts) return;
    setTab(readTab(location.search));
    setOnly(readOnlyPool());
    let live = true;
    void fetchMe().then(async (m) => {
      if (!live) return;
      setMe(m);
      if (!m) return;
      const p = await getPool();
      if (!live) return;
      setPool(p ?? []);
      setPoolFailed(p === null);
    });
    return () => {
      live = false;
    };
  }, []);

  const sync = (
    next: {
      usFirst: boolean;
      map: string | null;
      seq: string[];
    },
    tabNow: DraftTab = view,
  ) => {
    const qs = FEATURES.accounts ? withTab(encodeDraft(next), tabNow) : encodeDraft(next);
    history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : ""));
  };
  const showTab = (next: DraftTab) => {
    setTab(next);
    sync({ usFirst, map, seq }, next);
  };
  const toggleOnly = () => {
    setOnly(!only);
    writeOnlyPool(!only);
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
  const ranked = useMemo(
    () => recommend(heroes, seq, { matchups: loaded, map, comps }),
    [heroes, seq, loaded, map, comps],
  );
  const missing = picked.filter((s) => files.get(s) === null);
  const open = available(heroes, seq);
  const grid = filterHeroes(open, role, query);
  const next = st.next;
  // "내 영웅풀만": our team's picks inside the pool; bans and the other team's picks stay as they are
  const filtering = member && only && pool !== null;
  const ourPick = !!next && next.kind === "pick" && sideOf(next.side) === "us";
  const suggestions = (
    filtering && next
      ? onlyPool(ranked, pool, { kind: next.kind, ours: sideOf(next.side) === "us" })
      : ranked
  ).slice(0, SUGGEST_TOP);
  const poolEmpty = filtering && ourPick && pool.length === 0;
  const poolCount = pool ? pool.filter((n) => heroes.some((h) => h.name === n)).length : 0;
  const choGallBlocked =
    next?.kind === "pick" &&
    !open.some((h) => h.slug === "cho") &&
    !seq.includes("cho") &&
    !seq.includes("gall");

  const choose = (slug: string) => update({ seq: applyPick(seq, slug) });

  const board = (
    <>
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
              <div
                className={cx(
                  "border-b border-line px-3 py-2",
                  member && "flex items-start justify-between gap-3",
                )}
              >
                <div className="min-w-0">
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
                {member && (
                  <button
                    id="draft-only-pool"
                    type="button"
                    role="switch"
                    aria-checked={only}
                    onClick={toggleOnly}
                    className="flex shrink-0 items-center gap-2 rounded-md py-0.5 text-xs font-semibold text-fg-2 hover:text-fg"
                  >
                    <span
                      aria-hidden
                      className={cx(
                        "relative inline-block h-4 w-7 rounded-full border transition-colors",
                        only ? "border-primary bg-primary" : "border-line-strong bg-surface-3",
                      )}
                    >
                      <span
                        className={cx(
                          "absolute top-0.5 size-2.5 rounded-full transition-all",
                          only ? "left-3.5 bg-primary-ink" : "left-0.5 bg-fg-2",
                        )}
                      />
                    </span>
                    {t.pool.onlyPool}
                  </button>
                )}
              </div>
              {poolEmpty ? (
                <div id="draft-pool-empty" className="space-y-2 px-3 py-4 text-center">
                  <p className="text-[13px] text-fg-2">
                    <b className="block text-fg">{t.pool.emptyHead}</b>
                    {t.pool.emptyBody}
                  </p>
                  <button
                    type="button"
                    onClick={() => showTab("pool")}
                    className="rounded-lg bg-primary px-3 py-1.5 text-[13px] font-bold text-primary-ink hover:opacity-90"
                  >
                    {t.pool.emptyCta}
                  </button>
                </div>
              ) : filtering && ourPick && suggestions.length === 0 ? (
                <p id="draft-pool-none" className="px-3 py-4 text-center text-[13px] text-fg-2">
                  {t.pool.noneLeft}
                </p>
              ) : (
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
                          {member && !filtering && pool?.includes(s.hero.name) && (
                            <span data-in-pool className="ml-1.5 text-2xs font-semibold text-primary">
                              {t.pool.inPool}
                            </span>
                          )}
                        </span>
                        <span className="num flex flex-wrap gap-x-2 text-2xs text-muted">
                          {(["base", "allies", "enemies", "map", "comp"] as const).map(
                            (k) => (
                              <span key={k}>
                                {
                                  t.draft[
                                    `term${k[0]!.toUpperCase()}${k.slice(1)}` as "termBase"
                                  ]
                                }{" "}
                                <span data-term={k} data-value={s.terms[k]}>{signed(s.terms[k])}</span>
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
              )}
              {member && !poolEmpty && (
                <p id="draft-pool-note" className="border-t border-line px-3 py-1.5 text-2xs text-muted">
                  {filtering && ourPick ? (
                    <>
                      {t.pool.noteFiltered(poolCount)}{" "}
                      <button
                        type="button"
                        onClick={() => showTab("pool")}
                        className="font-semibold text-primary underline-offset-2 hover:underline"
                      >
                        {t.pool.editPool}
                      </button>
                    </>
                  ) : filtering ? (
                    t.pool.noteOthers
                  ) : (
                    t.pool.noteAll
                  )}
                </p>
              )}
              {FEATURES.accounts && me === null && (
                <p id="draft-pool-login" className="border-t border-line px-3 py-2 text-2xs text-fg-2">
                  {t.pool.guest}{" "}
                  <a
                    href={loginUrl(location.pathname + location.search)}
                    className="font-semibold text-primary underline-offset-2 hover:underline"
                  >
                    {t.pool.guestCta}
                  </a>
                </p>
              )}
              <p id="draft-comp-note" className="border-t border-line px-3 py-1.5 text-2xs text-muted">
                {t.draft.compNote}
              </p>
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
          className="rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs break-keep [overflow-wrap:anywhere] text-fg-2"
        >
          {draftRule(locale)}
        </p>
        <p className="text-2xs text-muted">{t.draft.orderSource}</p>
      </div>
    </>
  );

  return (
    <main className="page-x mt-6 space-y-4 pb-10">
      <PageHead
        title={t.draft.title}
        aside={
          member ? (
            <div
              role="tablist"
              aria-label={t.pool.tabsLabel}
              className="flex gap-0.5 rounded-lg border border-line bg-surface p-0.5"
            >
              {(["draft", "pool"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  id={`draft-tab-${k}`}
                  aria-selected={view === k}
                  aria-controls={k === "pool" ? "pool-view" : "draft-view"}
                  onClick={() => showTab(k)}
                  className={cx(
                    "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-bold transition-colors",
                    view === k ? "bg-surface-3 text-fg" : "text-muted hover:text-fg",
                  )}
                >
                  {k === "draft" ? t.pool.tabDraft : t.pool.tabPool}
                  {k === "pool" && (
                    <span
                      id="pool-count"
                      className="num min-w-5 rounded-full bg-primary px-1.5 text-center text-2xs font-bold text-primary-ink"
                    >
                      {poolCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : undefined
        }
      >
        <p className="num mt-0.5 text-xs text-muted">
          {t.draft.metaLine(patch)}
        </p>
      </PageHead>

      {view === "pool" && me && me !== "loading" && pool !== null ? (
        <div id="pool-view" role="tabpanel" aria-labelledby="draft-tab-pool">
          {poolFailed && (
            <p role="alert" className="mb-3 rounded-lg border border-neg/60 bg-surface-2 px-3 py-2 text-[13px] text-neg">
              {t.pool.loadFailed}
            </p>
          )}
          <HeroPool
            heroes={heroes}
            roles={roles}
            pool={pool}
            setPool={setPool}
            sources={sources}
            setSources={setSources}
            me={me}
            setMe={setMe}
          />
        </div>
      ) : member ? (
        <div id="draft-view" role="tabpanel" aria-labelledby="draft-tab-draft" className="space-y-4">
          {board}
        </div>
      ) : (
        board
      )}
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
