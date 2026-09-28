# STATUS — HPGG (hpgg.win)

Start every session here. Operating guide and architecture: `docs/HANDOFF.md`. Backlog: GitHub issues.

## State on 2026-09-28 (core features complete)
- **Live**: https://hpgg.win/hots/ (root `/` forwards here) — 홈 (role leaders, movers vs previous patch, map cards) · 영웅 티어 (QM/SL, SL rank brackets, per-map, ▲▼ vs previous patch, sortable) · 영웅 (grid, search, roles) · 영웅 상세 (tier/rank, cross-mode line, per-map win rates, brackets, popular talent builds with Korean names and icons, votes) · 전장 (cards → per-map tier table).
- **Pipeline**: daily cron collects 5 stats calls + 1 builds call, commits to `main`, archives to `snapshots`, deploys Pages. Verified end to end in Actions (test mode and live). Previous patch 2.55.17.97771 backfilled so deltas work from day one.
- **Data/localisation**: official Korean names from game strings; portraits, map previews and talent icons from HeroesToolChest (MIT), attributed in the footer.
- **Design**: v5 lol.ps-style navy skin (owner direction: LoL sites for the main UI, Overwatch sites only for maps).
- **Quality**: pytest 40 (90 % cov), vitest 26, Playwright 18; ruff/mypy/tsc clean.
- **Quota today**: Heroes/Stats 16/70, builds/all 1/7 (+1 tonight).

## Brand (2026-09-28, final)
- **hpgg.win — Happy Good Game** (owner purchased; logo + palette by the owner, see `docs/BRAND.md`). Custom domain attached to Pages 2026-09-28 (CNAME shipped from `data/`, Vite base `/`); HTTPS enforced. Umbrella brand for a multi-game meta site; Heroes of the Storm is the first game and lives under `/hots/`. Repo renamed to `blas1n/hpgg`. Naming history (hotsmeta.kr → hotsmeta.gg → diff.win (not purchasable) → hpgg.win) is in the design doc.

## Owner actions still open
1. Attach the purchased hpgg.win domain the custom domain to Pages (then set Vite `base` to `/`). Issue #5.
2. ~~GoatCounter~~ done — https://hpgg.goatcounter.com (page views + events `vote/<mode>/<slug>/<up|down>`).
3. First community post (Inven / Arca) with a screenshot; watch day-7 uniques vs day-1 (success criterion in the design doc).

## Next work
Next session: UI/UX improvements (see HANDOFF → "Starting UI/UX work"). Open issues: #1 light theme, #2 formula presets, #3 desktop density, #6 Xal'atath assets, #7 community, #8 player search (quota-constrained), #9 map detail, #10 i18n. Closed: #4 GoatCounter, #5 domain.

## History
- 2026-09-28: design (office-hours) → collector → repo/Actions/Pages → live data → five pages → table UI → official names + images → 폭풍 리그 naming, brackets, talent builds → lol.ps skin → handoff. Full detail in `git log` and `docs/DESIGN-2026-09-28.md` ("As built").
