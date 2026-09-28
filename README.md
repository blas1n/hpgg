# hotsmeta.kr

A Korean-language Heroes of the Storm tier list that matches how the game actually feels: Quick Match first, Storm League per map and per rank bracket, and the formula printed on the page. Data comes from the Heroes Profile API v1 once a day and is served as a static site. Design: `docs/DESIGN-2026-09-28.md`. Current state: `docs/STATUS.md`. How to operate and extend: `docs/HANDOFF.md`.

## Layout
- `collector/` — Python 3.11+ collector. `uv run python -m collector` makes the five daily calls (Quick Match, Storm League overall, Storm League league_tier 1-2 / 3-4 / 5-6, all with `group_by_map=true`) 60 seconds apart and **atomically** replaces `data/latest/{qm,sl,sl_low,sl_mid,sl_high,meta}.json`. Raw responses are kept as `data/.snapshot_out/<date>/*.json.gz` and archived on the `snapshots` branch.
- `data/latest/` — the frontend contract (schema in the design doc, "latest JSON schema"); `builds.json` holds the popular talent builds per hero.
- `tools/build_assets.py` — regenerates `data/talents_ko.json` and talent icons from HeroesToolChest game data (run it after a new hero ships; hero tables were produced the same way).
- `web/` — Vite + TypeScript static frontend, no framework. `src/formula.ts` is the tier formula (printed on the page); `npm test` runs vitest against the 2026-09-28 fixtures (13-hero verification table, presets, cuts), `npm run e2e` runs Playwright against a frozen data set in `tests/e2e-data`. Korean hero/map names and roles come from `data/heroes_ko.json` and `data/maps_ko.json`.
- `.github/workflows/collect-and-deploy.yml` — daily cron: collect → commit → archive snapshots → deploy to Pages. A push to `main` only rebuilds and deploys.

## Local run
```bash
cp .env.example .env   # fill HP_API_TOKEN (api account → API Keys)
uv sync
uv run pytest tests/ --cov=collector --cov-fail-under=80
uv run ruff check collector/ tests/ && uv run ruff format --check collector/ tests/ && uv run mypy collector/
uv run python -m collector      # ~5 min (group_by_map is limited to 1 request/min)

cd web && npm ci && npm test && npm run e2e && npm run build   # frontend; `npm run dev` serves ../data live
```
If the Heroes Profile account is in **Test Data** mode, calls cost no quota and return placeholder rows (and `group_by_map` is ignored, so only `map: "all"` rows are produced). In **Live Data** mode the real per-map payload arrives; Heroes/Stats allows 70 calls per rolling week on the Basic plan and one run uses 5.

## Rules
- The token lives only in `.env`. It never appears in logs, exceptions or commits (asserted by tests).
- Error responses and 202 job polling are not charged by Heroes Profile. Retries: one on 5xx/transport errors; one wait-and-retry on 429 honouring `Retry-After`.
- Attribution on every page: "Data provided by Heroes Profile".
- The workflow bot commits `data/latest` straight to `main`: `git pull --rebase` before you push, and never commit a local `data/latest`.
