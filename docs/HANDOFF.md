# HANDOFF — hotsmeta.gg

Last updated 2026-09-28. Read `docs/STATUS.md` first for the current state; this file is how to operate and extend the project.

## What this is
A static Korean-language Heroes of the Storm tier site. A Python collector pulls hero statistics once a day from the Heroes Profile API v1, commits JSON to `main`, and a Vite + TypeScript site computes tiers in the browser with a formula printed on the page. No server, no database, no accounts.

- Live: https://blas1n.github.io/hotsmeta/ (GitHub Pages; custom domain hotsmeta.gg not registered yet)
- Repo: https://github.com/blas1n/hotsmeta (public). Bot commits land on `main`; raw daily snapshots on the orphan `snapshots` branch.
- Design of record: `docs/DESIGN-2026-09-28.md`. E2E checklists: `docs/e2e/`.

## Architecture in one screen
```
GitHub Actions (cron 03:20 KST, workflow_dispatch, push:main)
  collect job (cron/dispatch only)
    uv run python -m collector
      GET /v1/patches                       → newest build with valid_globals
      5× GET /v1/heroes/stats?group_by_map  → qm, sl, sl_low(1-2), sl_mid(3-4), sl_high(5-6)   (60 s apart)
      1× GET /v1/heroes/talents/builds/all  → popular builds, qm+sl combined                    (7/week cap!)
      atomic swap → data/latest/{qm,sl,sl_low,sl_mid,sl_high,builds,meta}.json (+ data/previous/ on patch change)
      raw + normalised gz → data/.snapshot_out/<day>/ → committed to the `snapshots` branch
    git commit data/ → git pull --rebase --autostash → push
  deploy job (always)
    cd web && npm ci && npm run build   (Vite: publicDir=../data, base=/hotsmeta/)
    upload web/dist → GitHub Pages
```
Frontend pages: `index.html` (홈), `tier.html` (영웅 티어), `heroes.html`, `hero.html?hero=<slug>`, `maps.html`. Shared: `web/src/formula.ts` (tiers), `web/src/data.ts` (loaders + types), `web/src/lib/nav.ts` (chrome).

## The formula (web/src/formula.ts — printed on the page)
```
WRs   = 50 + (WR − 50) × n / (n + 500)                 shrink small samples toward 50
score = pick% × (WRs − 50) × 3 + ban% × 1              multiplicative ("아이치"); QM has no ban term
tiers = heroes with n ≥ 200, sorted by score, cut at cumulative 6/24/54/82/94 % → S/A/B/C/D/F
        boundary_i = min(N, max(floor(share_i·N), boundary_{i−1}+1))  (monotonic, ≥1 per tier)
```
Why multiplicative: an additive formula ((WRs−50)+0.15·pick+0.15·ban) reproduces HOTS GG and promotes low-win-rate popular heroes (Brightwing 47.6 % WR → A). 45/90 heroes change tier between the two on the 2026-09-28 fixture. Presets exist in code (`PRESETS.additive`, `PRESETS.winrate`) but are not exposed in the UI yet.

## Quotas and costs (Heroes Profile Basic, $5/month, rolling 7-day windows per endpoint)
| Endpoint | Weekly cap | Daily use |
|---|---|---|
| Heroes/Stats | 70 | 5 |
| Heroes/Talents/Builds/All | **7** | 1 (quota_exceeded → collector keeps yesterday's builds.json, run still succeeds) |
| Patches, Heroes, Maps | 1,000,000 | 1 |
Error responses and 202 job polling are not charged. `group_by_map=true` is rate-limited to 1 request/minute, hence the 60 s spacing (a run takes ~6 minutes). A manual `workflow_dispatch` costs a full day's calls — do not run it casually; the builds/all budget has no slack.

## Operating notes
- **Never** use `api.heroesprofile.com` or `?api_token=`: that is the old API (off 2027-01-01). v1 is `https://www.heroesprofile.com/api/external/v1` with `Authorization: Bearer <key>`. Key lives in `.env` locally and in the Actions secret `HP_API_TOKEN`. The key page shows "Last Used"; if it says Never, you are hitting the wrong host.
- Account **Data mode** must be Live Data. Test Data mode returns placeholder rows and ignores `group_by_map` (the collector logs `normalize.flat_payload` and writes only `map: "all"` rows).
- Local runs write `data/latest/`; **never commit it** (`git reset data/latest` before committing). The bot owns that path. Always `git pull --rebase --autostash` before pushing.
- Previous-patch data (`data/previous/`) rotates automatically on a patch change. To seed it after a gap: `uv run python -m collector --previous <build>` (5 calls).
- New hero or map: rerun `uv run python tools/build_assets.py --build <heroes-data build>` to refresh `data/talents_ko.json` and talent icons; extend `data/heroes_ko.json` / `data/maps_ko.json` the same way (names come from the game's Korean strings in HeroesToolChest/heroes-data, portraits/maps/icons from heroes-images, both MIT). Known gap: Xal'atath appears in builds/all but not yet in stats or the 2.55.16.97039 game-data dump.
- Bracket match counts overlap (a match counts in every bracket its players belong to); never add bracket totals together.
- Playwright e2e runs against a frozen data set in `web/tests/e2e-data` (2026-09-28 fixtures) so tier expectations are deterministic. Unit fixtures for the formula are the same day's web-scraped tables in `web/tests/fixtures`.

## Gates (all must pass before a commit)
```bash
uv run ruff check collector/ tests/ tools/ && uv run ruff format --check collector/ tests/ tools/
uv run mypy collector/
uv run pytest tests/ --cov=collector --cov-fail-under=80        # 40 tests, ~90 %
cd web && npx tsc --noEmit && npm test && npm run e2e            # 26 vitest, 18 Playwright
```

## Where things are
- `collector/` client (Bearer, 202 polling, bounded retries), snapshot (normalisation, atomic commit, meta), run (orchestration, backfill), `__main__` (CLI, JSON logging; token never logged — asserted by tests)
- `tools/build_assets.py` asset/localisation generator (tests in `tests/test_build_assets.py`)
- `web/src/pages/*.ts` one module per page; `web/e2e/*.spec.ts`; `web/tests/formula.test.ts`
- `.github/workflows/collect-and-deploy.yml`
- `docs/hp-api-v1-variables.md` accepted parameter values (from the v1 docs)

## Backlog (see GitHub issues)
UI polish (light theme toggle, desktop density, formula presets in the UI), analytics (GoatCounter so 👍👎 votes reach us), custom domain, community/comments, player search (Basic plan gives only 25 player calls/week — needs a plan change or a different design), Xal'atath assets.
