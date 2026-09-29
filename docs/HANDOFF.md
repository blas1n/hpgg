# HANDOFF — HPGG (hpgg.win)

Last updated 2026-09-29. Read `docs/STATUS.md` first for the current state; this file is how to operate and extend the project.

## What this is
A static Korean-language Heroes of the Storm tier site. A Python collector pulls hero statistics once a day from the Heroes Profile API v1, commits JSON to `main`, and a Next.js static export (React 19 + Tailwind 4, `output: "export"`) renders the site; tiers are computed from the same JSON at build time (홈, search index) and in the browser (tier table, hero detail) with the formula printed on the page. Player search (전적 검색) is the one live feature: the page calls our own API server (`server/`, https://api.hpgg.win, Docker on the owner's Mac mini), which calls Heroes Profile with the key and caches the answers — see "Server (api.hpgg.win)". No accounts yet (#28).

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
      2× GET /v1/heroes/stats?region=…      → today's region: qm_<r>, sl_<r> (kr → na → eu by day index); other regions carried
      1× GET /v1/heroes/talents/builds/all  → popular builds, qm+sl combined                    (7/week cap!)
      atomic swap → data/latest/{qm,sl,sl_low,sl_high,builds,meta}.json (+ data/previous/ on patch change)
      ≤90× GET /v1/heroes/matchups?hero=…   → data/matchups/<slug>.json, SL, heroes due only   (2 s apart, ≤25 min)
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
Why multiplicative: an additive formula ((WRs−50)+0.15·pick+0.15·ban) reproduces HOTS GG and promotes low-win-rate popular heroes (Brightwing 47.6 % WR → A). 45/90 heroes change tier between the two on the 2026-09-28 fixture. The tier page offers the presets (`PRESETS`: 아이치 default · 가산식 · 승률만) in a `#preset` select and `?preset=additive|winrate`; heroes whose tier differs from 아이치 are marked (`data-changed`, a "기본 X" chip) and the printed formula (`formulaLine`, `formulaDetail`) follows the selection. 홈, 영웅 and 영웅 상세 always use 아이치. The default view is pre-rendered exactly as before presets (`baseTier` is only set under another preset).

## Quotas and costs (Heroes Profile Basic, $5/month, rolling 7-day windows per endpoint)
| Endpoint | Weekly cap | Daily use |
|---|---|---|
| Heroes/Stats | 70 | 4 global + 2 region = 6 (42/week; 28 left for a 4-call previous-patch backfill and a rerun) |
| Heroes/Talents/Builds/All | **7** | 1 (quota_exceeded → collector keeps yesterday's builds.json, run still succeeds) |
| Hero/Matchups | 700 | 90 every other day (315/week; a patch change adds one early round → ≤ 450) |
| Patches, Heroes, Maps | 1,000,000 | 1 |
Error responses and 202 job polling are not charged. `group_by_map=true` is rate-limited to 1 request/minute, hence the 60 s spacing (the stats part of a run takes ~7 minutes). `/heroes/matchups` without `group_by_map` answers `X-RateLimit-Limit: 60` (per minute, measured 2026-09-29) → 2 s spacing. Every charged answer carries `X-HP-Quota-Remaining`/`-Limit`, logged as `hp.quota`. `quota_exceeded` is never waited out (its Retry-After is the weekly reset, ~6 days). A manual `workflow_dispatch` costs a full day's calls — do not run it casually; the builds/all budget has no slack.

### Matchups (counters / synergies, #15)
- `collector/matchups.py`. Storm League only (owner, Basic plan). One call per hero; recorded answer in `tests/fixtures/live_probe_matchups_abathur_sl_2.55.17.98025.json.gz`: `{ally, enemy, combined}`, one row per other hero with `wins`/`losses`/`games_played` from the asked hero's side — but on `enemy` rows `win_rate` is the asked hero's **loss** rate, so the collector recomputes every win rate from wins/games. `combined` is not stored.
- **Gate (per hero file)**: due when the file is missing, is for another patch, or was collected ≥ 2 calendar days (UTC) ago. A failed, quota-stopped or time-boxed round leaves the other files as they are and those heroes are simply due again tomorrow. Matchups never fail the run.
- **Patch**: the one the pages show for Storm League — the previous patch while the current sample is thin (same rule as `web/src/data.ts` `thinSample`), so the section is not empty for the week after a patch.
- **Ranking** (`web/src/lib/matchups.ts`, printed on the page): score = (pair win rate − the hero's own win rate in the same sample) × n/(n+100); pairs under 50 games are left out; top 5 enemies with the lowest score (상대하기 어려운 영웅) and allies with the highest (잘 맞는 영웅). The page shows the unshrunk gap (%p) and games.
- Pages show the section in both modes, labelled 폭풍 리그; without a file the section says the data comes with the next collection.

### Regions (아시아 / 아메리카 / 유럽, #14)
- Owner decision (Basic plan): a rotation — each day ONE region for QM + SL with `group_by_map` (2 calls). Region = `REGIONS[(day − 2026-09-30) mod 3]` → KR, NA, EU, KR, … (`collector/snapshot.py` `region_for_day`, UTC date of the run). Each region is at most 3 days old; the page prints each region's own date (`meta.modes[<key>].collected_at`).
- Files `data/latest/{qm,sl}_{kr,na,eu}.json` (carry `"region": "KR"` …; global files `"region": null`). The run carries the other regions' files forward while they are for the same patch; on a patch change they move into `previous/` with everything else and are not carried. A failed region call never fails the run (that region keeps its files and comes round in 3 days). `--previous <build>` stays 4 calls (global only) and keeps previous region files of that same build.
- Region × bracket is not collected: on the tier table the region select disables the bracket select and vice versa, with the reason printed; `?region=kr|na|eu` (a region in the URL wins over `tier=`). Regions exist for both modes; map filtering works inside a region (group_by_map).
- A region file is a different cohort (`lib/cohort.ts`): no ▲▼ against the global file; a region's thin sample is judged by its own `heroes_over_200` (`#region-note` warns). CN is not collected.
- Hero detail: 지역별 section — the hero's tier/rank/win rate per collected region for the current mode.

## Operating notes
- **Never** use `api.heroesprofile.com` or `?api_token=`: that is the old API (off 2027-01-01). v1 is `https://www.heroesprofile.com/api/external/v1` with `Authorization: Bearer <key>`. Key lives in `.env` locally and in the Actions secret `HP_API_TOKEN`. The key page shows "Last Used"; if it says Never, you are hitting the wrong host.
- Account **Data mode** must be Live Data. Test Data mode returns placeholder rows and ignores `group_by_map` (the collector logs `normalize.flat_payload` and writes only `map: "all"` rows).
- Local runs write `data/latest/` and `data/matchups/`; **never commit them** (`git reset data/latest data/matchups` before committing). The bot owns those paths. Always `git pull --rebase --autostash` before pushing.
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
uv run pytest tests/ --cov=collector --cov-fail-under=80        # collector ~90 % (tests/ also runs tests/server)
uv run ruff check server/ tests/server/ && uv run ruff format --check server/ tests/server/
uv run mypy server/
uv run pytest tests/server/ --cov=server --cov-fail-under=80    # ~99 %
docker build -f deploy/Dockerfile -t hpgg-api:ci .               # the server image builds
cd web && npx tsc --noEmit && npm run test:cov && npm run e2e     # E2E_PORT=4391 when another checkout is serving 4173
```

## Server (api.hpgg.win)
HPGG's application backend. Today it serves player search; accounts (#28, Battle.net login) and community (#7) are meant to land here as further feature modules, not as new services.

```
browser (hpgg.win/hots/players/?tag=Name%231234&region=KR)
  → GET https://api.hpgg.win/v1/players?battletag=Name%231234&region=KR
  → Cloudflare (TLS, CF-Connecting-IP) → cloudflared tunnel → 127.0.0.1:8800 on the Mac mini (bsserver)
  → container hpgg-api (FastAPI/uvicorn :8000) → SQLite cache → Heroes Profile GET /players (Bearer, server-side only)
```
- **Shape**: `server/app.py` `create_app(settings)` — CORS allowlist, JSON error envelope `{"error": {"code", "message"}}`, one structured log line per request, `/healthz`, then one router per feature (`server/players/router.py`). A new feature = a package with its router, tables on `server.db.Base` (imported in `server/models.py`) and an Alembic revision.
- **Persistence**: one SQLite file (WAL) on the named volume `hpgg-api-data` (`/data/hpgg.sqlite`), SQLAlchemy async (aiosqlite), schema only through Alembic (`server/migrations/versions/`, applied at startup; `tests/server/test_db.py` fails if models and migrations drift). Why SQLite and not Postgres: one process on one Mac mini, a small write load (cache rows, later accounts/comments), nothing to operate or back up beyond one file; moving to Postgres later is a driver/URL change plus a data copy, because everything goes through SQLAlchemy and Alembic. The player cache lives in the same database (tables `hp_cache`, `hp_quota`, `hp_daily_usage`) — one volume, one backup.
- **Player search**: one HP call per new player — `/players` (bucket *Player*, 10,000/week) returns account level, win rate, KDA, MVP, current MMR + league per mode (`*_mmr_data`), top-3 heroes/maps and the last 5 matches with MMR change (`matchData`), so the page needs no other endpoint. The server trims the ≈30 KB answer (talent objects) to a compact profile (`server/players/profile.py`, shape in `tests/server/fixtures/v1_players_200.json`, recorded 2026-09-29).
- **Quota guard** (`server/players/service.py`): fresh cache 6 h (not-found 1 h) → identical concurrent lookups share one call → live call only while HP's `X-HP-Quota-Remaining` > `QUOTA_FLOOR` (200) and today's live calls < `DAILY_LIVE_BUDGET` (1,300 per UTC day). Otherwise, or after a 429 `quota_exceeded` (until its Retry-After), the page gets the cached profile marked `stale` with `notice: "quota_exceeded"`, or a 429 `quota_exceeded` ("오늘 조회 한도 초과") for a player never seen. HP 5xx/timeouts → cached profile with `notice: "upstream_unavailable"`, or 503. `/healthz` shows the last quota reading and today's live calls. `X-HP-Quota-Reset` is seconds until the window frees up (measured).
- **Abuse**: 20 requests/min per visitor IP (`CF-Connecting-IP`, sliding window, in memory); inputs validated (BattleTag `name#digits`, region KR/NA/EU/CN, unknown params rejected); 404s from HP are free, so random tags cost nothing.
- **Never** log or return the HP key or the Authorization header (`tests/server/test_app.py` asserts it on every error path).

| Player endpoint (Basic, weekly) | Cap | Used by the site |
|---|---|---|
| `/players` | 10,000 | yes — every new search (cached 6 h) |
| `/players/mmr` (+ `/heroes`, `/roles`, `/history*`) | 10,000 each | no (`/players` already carries MMR + league) |
| `/players/matches` (match history) | 250 | no |
| `/players/heroes*`, `/roles*`, `/maps*`, `/matchups`, `/friendfoe`, `/talents/build`, `/awards*` | 25 each | no — never in the default flow |

**Config** (`deploy/.env` on the host, gitignored; template `deploy/.env.example`): `HP_API_TOKEN` (required, same key as the collector), optional `CORS_ORIGINS` (JSON list, default `["https://hpgg.win"]`), `LOG_LEVEL`, `PLAYER_TTL_SECONDS`, `NOT_FOUND_TTL_SECONDS`, `QUOTA_FLOOR`, `DAILY_LIVE_BUDGET`, `IP_REQUESTS_PER_MINUTE`. The web page reads `NEXT_PUBLIC_API_BASE` at build time (default `https://api.hpgg.win`); if the API is unreachable it shows "전적 검색 준비 중".

**Deploy / operate** (host `bsserver`, Docker context `colima`):
- autodeploy (`~/Works/_infra/scripts/autodeploy.sh`, every 2 min) rebuilds on a new `origin/main`: `docker-compose -p hpgg -f <WORK>/deploy/docker-compose.yml up -d --build --force-recreate` (project name = lower-cased repo dir). The image copies only `pyproject.toml`, `uv.lock` and `server/`, so the daily data commits rebuild from cache and just recreate the container (a few seconds; the cache survives on the volume, the per-IP limiter resets).
- Manual restart: `docker --context colima restart hpgg-api`; health: `curl -s http://127.0.0.1:8800/healthz` on the host, `https://api.hpgg.win/healthz` outside.
- Logs: `docker --context colima logs -f hpgg-api` — JSON lines (structlog + uvicorn), json-file driver capped at 5×10 MB.
- Data: `docker --context colima volume inspect hpgg-api-data`; do not open the live SQLite from the host (copy it out first).
- Local run: `HP_API_TOKEN=… CORS_ORIGINS='["http://localhost:5173"]' uv run python -m server` (DB in `data/.tmp/`), then `NEXT_PUBLIC_API_BASE=http://localhost:8000 npm run dev` in `web/`.
- New migration: change models, `mkdir -p data/.tmp && uv run alembic -c server/alembic.ini revision --autogenerate -m "…"`, review, run `tests/server/test_db.py`.

## Future: accounts (Battle.net login, #28)
Not built. Verified from the Battle.net developer docs ("Using OAuth", 2026-09-29): OAuth 2.0 authorization-code flow at `https://oauth.battle.net/authorize` / `/token` for US, EU and APAC (APAC replaced the old kr/tw regions; China uses `oauth.battlenet.com.cn`); login needs no scope — without scopes an app gets the account ID and BattleTag; the `openid` scope exposes OIDC `https://oauth.battle.net/userinfo` (authorization-code token required); redirect URIs must be HTTPS; access tokens last 24 h. Plan: `server/accounts/` module on this server (`/v1/auth/battlenet/login|callback`, `state` check), HttpOnly Secure session cookie for `.hpgg.win`, store only account id + BattleTag; the BattleTag links straight to 전적 검색. **Unverified**: exact `/userinfo` field names, whether Battle.net reveals the player's HotS region (probably not — the page may still ask for the region), refresh-token behaviour.

## Where things are
- `collector/` client (Bearer, 202 polling, bounded retries, quota log), snapshot (normalisation, atomic commit, meta), matchups (per-hero counters/synergies), run (orchestration, backfill), `__main__` (CLI, JSON logging; token never logged — asserted by tests)
- `server/` the API (FastAPI): `app.py` factory, `players/` feature (hp client, profile, service, store, router, models), `db.py` + `migrations/` (Alembic), `logs.py`, `ratelimit.py`; tests in `tests/server/` with recorded HP fixtures; `deploy/` Dockerfile + compose
- `tools/build_assets.py` asset/localisation generator (tests in `tests/test_build_assets.py`)
- `web/app/` routes; `web/src/{components,lib,legacy,server,styles}`; `web/e2e/*.spec.ts` (served like Pages by `scripts/serve.mjs`); `web/tests/*.test.ts`
- `.github/workflows/collect-and-deploy.yml` (collect + deploy on main), `.github/workflows/ci.yml` (all gates on every PR)
- `docs/hp-api-v1-variables.md` accepted parameter values (from the v1 docs)

## UI/UX work
- Direction from the owner: production-site level; main UI follows LoL stat sites (lol.ps first), Overwatch sites only as a reference for maps; brand palette from `docs/BRAND.md` (tokens in `web/src/styles/globals.css`). Tier badge colours stay separate from the brand palette.
- Copy: never claim the tiers "match your gut feel" (owner, 2026-09-28) — state what the site does. No voting.
- Themes (#1): navy is the default and the brand; light is opt-in from the header toggle (`ThemeToggle`). The choice is stored in `localStorage["hpgg-theme"]` (reads/writes wrapped in try/catch — blocked storage means the choice lasts for the visit) and applied by an inline script in `app/layout.tsx` (`THEME_INIT_SCRIPT`, `src/lib/theme.ts`) before first paint. `prefers-color-scheme` is deliberately **not** followed: a visitor sees light only after choosing it. Light values for every themed token live under `:root[data-theme="light"]` in `globals.css`; tier and role colours are shared. Use tokens, never raw hex or `text-white`, in components. Contrast is gated twice: `tests/theme.test.ts` (token pairs, AA) and `e2e/theme.spec.ts` (every visible text run on every page, both themes, 390/1280).
- Korean-first UI, but do not add Korea-only framing: the long-term goal is a global, multi-game community (issue #10 for i18n). Community comes later, so keep the header search generic (player search has its own page and the box on 홈).
- Loop: `cd web && npm run dev` serves live data at http://localhost:5173/hots/ (dev builds into `.next-dev`, so a build or `npm run e2e` never breaks a running dev server); check phone (390 px) and desktop (1280 px) widths. On a real phone over Tailscale use the Mac's MagicDNS name or put its Tailscale IP in `web/.env.local` as `DEV_ORIGINS=100.x.y.z` (Next 16 blocks other dev origins). A `window.ethereum` error in the dev overlay comes from the Brave wallet, not from the site; `npm run e2e` pins behaviour (selectors are ids/data-attributes, not styles).
- Next: #12 — rebuild the legacy pages in React one PR each (tier table → hero detail → heroes → maps, with #3 desktop density), then #1 light theme, #2 formula presets. Community (#7) and accounts (#28) build on the API server (see "Server").

## Backlog (see GitHub issues)
UI polish (#1 light theme, #2 formula presets, #3 desktop density), i18n (#10), community/comments (#7), accounts with Battle.net login (#28), Xal'atath (appears after a build_assets.py rerun with a 2.57 heroes-data build). Player search (#8) is built on `/players` (10,000/week); it closes once api.hpgg.win is live.
