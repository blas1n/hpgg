# HANDOFF — HPGG (hpgg.win)

Last updated 2026-09-29. Read `docs/STATUS.md` first for the current state; this file is how to operate and extend the project.

## What this is
A static Korean-language Heroes of the Storm tier site. A Python collector pulls hero statistics once a day from the Heroes Profile API v1, commits JSON to `main`, and a Next.js static export (React 19 + Tailwind 4, `output: "export"`) renders the site; tiers are computed from the same JSON at build time (홈, search index) and in the browser (tier table, hero detail) with the formula printed on the page. No server, no database, no accounts.

- Live: https://hpgg.win/hots/ (GitHub Pages + custom domain, HTTPS enforced; `data/CNAME` is published with the site so the domain survives every deploy). Root `/` forwards to `/hots/`; a second game would live at `/<game>/`.
- Brand: hpgg.win — Happy Good Game. Logo, crops and palette in `docs/BRAND.md` and `data/img/brand/`.
- Analytics: https://hpgg.goatcounter.com — page views. (👍👎 voting was removed 2026-09-28; formula feedback goes to contact@hpgg.win.)
- Repo: https://github.com/blas1n/hpgg (public). Bot commits land on `main`; raw daily snapshots on the orphan `snapshots` branch.
- Design of record: `docs/DESIGN-2026-09-28.md`. E2E checklists: `docs/e2e/`.

## Architecture in one screen
```
GitHub Actions (cron 03:20 KST, workflow_dispatch, push:main)
  collect job (cron/dispatch only)
    uv run python -m collector
      GET /v1/patches                       → newest build with valid_globals
      4× GET /v1/heroes/stats?group_by_map  → qm, sl, sl_low(1-4), sl_high(5-6)   (60 s apart)
      1× GET /v1/heroes/talents/builds/all  → popular builds, qm+sl combined                    (7/week cap!)
      atomic swap → data/latest/{qm,sl,sl_low,sl_high,builds,meta}.json (+ data/previous/ on patch change)
      raw + normalised gz → data/.snapshot_out/<day>/ → committed to the `snapshots` branch
    git commit data/ → git pull --rebase --autostash → push
  deploy job (always)
    cd web && npm ci && npm run build   (sync ../data → public/, tsc, next build → web/dist)
    upload web/dist → GitHub Pages
```
Frontend (`web/`, Next.js App Router, static export to `web/dist`):
- Routes: `app/hots/page.tsx` 홈 · `app/hots/tier/` 영웅 티어 · `app/hots/heroes/` 영웅 · `app/hots/heroes/[slug]/` 영웅 상세 (one static page per hero, unknown slug → 404) · `app/hots/maps/` 전장 · `app/page.tsx` root redirect · `app/not-found.tsx`. Old `hots/*.html` addresses forward via `web/legacy-redirects/`.
- Data: `scripts/sync-data.mjs` copies `DATA_DIR` (default `../data`) into `public/` (gitignored) so the export ships it verbatim; server components read the same files through `src/server/data.ts`, client code fetches them through `src/data.ts`.
- Design system: tokens in `src/styles/globals.css` (`@theme`: surfaces, brand, tier and role colours), primitives in `src/components/ui.tsx` (TierBadge, Portrait, RankDelta, Card, Segmented), chrome in `SiteHeader` (hero search: Korean / English / 초성, `/` to focus) and `SiteFooter`.
- Rebuilt in React: shell + 홈 (`src/components/home/HomeView.tsx`, view models in `src/lib/home.ts`). **Not yet rebuilt**: tier, heroes, hero detail, maps run their old imperative modules (`src/legacy/*.ts`) inside `LegacyPage` over server-rendered skeletons (`src/legacy/markup.ts`), styled by `src/styles/legacy.css` in a cascade layer below the utilities. Rebuild one page per PR and delete its legacy module, markup and CSS.

## The formula (web/src/formula.ts — printed on the page)
```
WRs   = 50 + (WR − 50) × n / (n + 500)                 shrink small samples toward 50
score = pick% × (WRs − 50) × 3 + ban% × 1              multiplicative ("아이치"); QM has no ban term
tiers = heroes with n ≥ 200 (and in heroes_ko.json — see below), sorted by score, cut at cumulative 6/24/54/82/94 % → S/A/B/C/D/F
        boundary_i = min(N, max(floor(share_i·N), boundary_{i−1}+1))  (monotonic, ≥1 per tier)
```
Why multiplicative: an additive formula ((WRs−50)+0.15·pick+0.15·ban) reproduces HOTS GG and promotes low-win-rate popular heroes (Brightwing 47.6 % WR → A). 45/90 heroes change tier between the two on the 2026-09-28 fixture. Presets exist in code (`PRESETS.additive`, `PRESETS.winrate`) but are not exposed in the UI yet.

## Quotas and costs (Heroes Profile Basic, $5/month, rolling 7-day windows per endpoint)
| Endpoint | Weekly cap | Daily use |
|---|---|---|
| Heroes/Stats | 70 | 4 (28/week; the rest is room for backfills) |
| Heroes/Talents/Builds/All | **7** | 1 (quota_exceeded → collector keeps yesterday's builds.json, run still succeeds) |
| Patches, Heroes, Maps | 1,000,000 | 1 |
Error responses and 202 job polling are not charged. `group_by_map=true` is rate-limited to 1 request/minute, hence the 60 s spacing (a run takes ~5 minutes). A manual `workflow_dispatch` costs a full day's calls — do not run it casually; the builds/all budget has no slack.

## Operating notes
- **Never** use `api.heroesprofile.com` or `?api_token=`: that is the old API (off 2027-01-01). v1 is `https://www.heroesprofile.com/api/external/v1` with `Authorization: Bearer <key>`. Key lives in `.env` locally and in the Actions secret `HP_API_TOKEN`. The key page shows "Last Used"; if it says Never, you are hitting the wrong host.
- Account **Data mode** must be Live Data. Test Data mode returns placeholder rows and ignores `group_by_map` (the collector logs `normalize.flat_payload` and writes only `map: "all"` rows).
- Local runs write `data/latest/`; **never commit it** (`git reset data/latest` before committing). The bot owns that path. Always `git pull --rebase --autostash` before pushing.
- Previous-patch data (`data/previous/`) rotates automatically on a patch change. To seed it after a gap: `uv run python -m collector --previous <build>` (4 calls).
- **Only heroes with assets are shown** (#6, owner 2026-09-29: a new hero has no meaningful data at first anyway). A hero in the stats but not in `data/heroes_ko.json` is dropped from every page — tier table, 홈, 영웅, search, 전장, hero pages — by one rule, `web/src/lib/known.ts`, applied at both snapshot entry points (`pickShown` at build time, `loadSnapshot` in the browser). It is dropped **before** the tier cut, so tiers are computed over the heroes on the page. The daily run logs `run.heroes_without_assets` (warning) listing them.
- New hero: rerun `uv run python tools/build_assets.py --build <heroes-data build>` once HeroesToolChest/heroes-data has a build with that hero. It rewrites `data/heroes_ko.json` (every hero already listed or seen in `data/latest/`, if the build has it; Korean name and role from the game strings), fetches missing portraits (heroes-images draft portrait, 96 px), and refreshes `data/talents/<hero slug>.json` (Korean name, icon, tooltip text with `{{…}}` highlights, cooldown — one file per hero so a hero page loads ~7 KB) and talent icons (`--icons data/latest/builds.json` to fetch only icons used in builds; `--skip-icons` for tables only). Heroes the build lacks are logged (`assets.heroes_without_game_data`) and stay hidden. Rerunning with 2.55.16.97039 reproduces today's tables byte for byte. `data/maps_ko.json` is still extended by hand. Both sources MIT.
- Xal'atath (patch 2.57.0.98285, 2026-09-28) is in the stats and builds but not in heroes-data yet (newest 2.55.16.97039; heroes-images already has her 2.57 PTR portrait and talent icons), so she is hidden until then.
- Brackets are 브실골플 (league_tier 1-4) / 다마그 (5-6) since 2026-09-29 (owner: the player base is small; split further when samples allow). History: 1-2 / 3-4 / 5-6 → 1-3 / 4-5 / 6 (마그마 alone had 3,427 matches and only 56/90 heroes over 200 games) → 1-4 / 5-6. HP has no grandmaster id: grandmasters are inside master (6). A previous-patch bracket file with a different `league_tier` is a different cohort, so the tier page shows no ▲▼ for it (`web/src/lib/cohort.ts`).
- Bracket match counts overlap (a match counts in every bracket its players belong to); never add bracket totals together.
- Playwright e2e runs against a frozen data set in `web/tests/e2e-data` (2026-09-28 fixtures) so tier expectations are deterministic. Unit fixtures for the formula are the same day's web-scraped tables in `web/tests/fixtures`.

## Gates (all must pass before a commit)
```bash
uv run ruff check collector/ tests/ tools/ && uv run ruff format --check collector/ tests/ tools/
uv run mypy collector/
uv run pytest tests/ --cov=collector --cov-fail-under=80        # 40 tests, ~90 %
cd web && npx tsc --noEmit && npm run test:cov && npm run e2e     # 43 vitest (95 %), 25 Playwright
```

## Where things are
- `collector/` client (Bearer, 202 polling, bounded retries), snapshot (normalisation, atomic commit, meta), run (orchestration, backfill), `__main__` (CLI, JSON logging; token never logged — asserted by tests)
- `tools/build_assets.py` asset/localisation generator (tests in `tests/test_build_assets.py`)
- `web/app/` routes; `web/src/{components,lib,legacy,server,styles}`; `web/e2e/*.spec.ts` (served like Pages by `scripts/serve.mjs`); `web/tests/*.test.ts`
- `.github/workflows/collect-and-deploy.yml` (collect + deploy on main), `.github/workflows/ci.yml` (all gates on every PR)
- `docs/hp-api-v1-variables.md` accepted parameter values (from the v1 docs)

## UI/UX work
- Direction from the owner: production-site level; main UI follows LoL stat sites (lol.ps first), Overwatch sites only as a reference for maps; brand palette from `docs/BRAND.md` (tokens in `web/src/styles/globals.css`). Tier badge colours stay separate from the brand palette.
- Copy: never claim the tiers "match your gut feel" (owner, 2026-09-28) — state what the site does. No voting.
- Korean-first UI, but do not add Korea-only framing: the long-term goal is a global, multi-game community (issue #10 for i18n). Player search and community come later, so keep the header search generic.
- Loop: `cd web && npm run dev` serves live data at http://localhost:5173/hots/ (dev builds into `.next-dev`, so a build or `npm run e2e` never breaks a running dev server); check phone (390 px) and desktop (1280 px) widths. On a real phone over Tailscale use the Mac's MagicDNS name or put its Tailscale IP in `web/.env.local` as `DEV_ORIGINS=100.x.y.z` (Next 16 blocks other dev origins). A `window.ethereum` error in the dev overlay comes from the Brave wallet, not from the site; `npm run e2e` pins behaviour (selectors are ids/data-attributes, not styles).
- Next: #12 — rebuild the legacy pages in React one PR each (tier table → hero detail → heroes → maps, with #3 desktop density), then #1 light theme, #2 formula presets. Player search (#8) and community (#7) need a design session first (quota; no backend today) — see STATUS "Next session".

## Backlog (see GitHub issues)
UI polish (#1 light theme, #2 formula presets, #3 desktop density), i18n (#10), community/comments (#7), player search (Basic plan gives only 25 player calls/week — needs a plan change or a different design), Xal'atath (appears after a build_assets.py rerun with a 2.57 heroes-data build).
