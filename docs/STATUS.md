# STATUS — HPGG (hpgg.win)

Start every session here. Operating guide and architecture: `docs/HANDOFF.md`. Backlog: GitHub issues.

## State on 2026-09-29 (Next.js rebuild merged, #11)
- **Live**: https://hpgg.win/hots/ (root `/` forwards here). Pages: 홈 (today's meta: role leaders, tier top 10, risers/fallers vs previous patch, map cards) · 영웅 티어 `/hots/tier/` (QM/SL, SL brackets, per-map, ▲▼, sortable) · 영웅 `/hots/heroes/` · 영웅 상세 `/hots/heroes/<slug>/` (90 pre-rendered pages; three stat cards, per-map win rates, brackets, sticky section tabs, talent builds with a description popover) · 전장 `/hots/maps/`. Old `hots/*.html` addresses forward.
- **Stack**: Next.js 16 (App Router, static export, Turbopack) + React 19 + Tailwind 4 on GitHub Pages. Shell (header with hero search incl. 초성, footer with contact@hpgg.win), 홈, 영웅 티어 and 영웅 상세 are React (hero pages are fully pre-rendered: both modes, builds and talent text in the page, no fetch); 영웅 and 전장 still run their legacy modules inside the new shell — **#12** rebuilds them one PR each (next: heroes).
- **Pipeline**: daily cron (03:20 KST) collects 4 stats calls (QM, SL, SL 브실골플 1-4, SL 다마그 5-6) + 1 builds call, commits to `main`, archives to `snapshots`, deploys Pages. Previous patch 2.55.17.97771 re-backfilled with the two brackets on 2026-09-29.
- **Data/localisation**: Korean names and talent tooltips from the game strings (HeroesToolChest, MIT), one talent file per hero (`data/talents/<slug>.json`); portraits, maps, icons from heroes-images (MIT).
- **Quality**: pytest 43 (90 % cov), vitest 45 (95 %), Playwright 30; ruff/mypy/tsc clean. Every PR runs all gates (`.github/workflows/ci.yml`).
- **Quota**: Heroes/Stats ~30/70 in the rolling week (two bracket backfills on 2026-09-29; daily use 4 → 28/week); builds/all 1/7 per day.

## First thing to check next session
The first cron after the merge (2026-09-29 03:20 KST) is the first live run of the 4-call collector:
- the run succeeded and made 4 `/heroes/stats` calls;
- `data/latest/` has `sl_low.json` with `league_tier [1,2,3,4]`, `sl_high.json` with `[5,6]`, and **no `sl_mid.json`**;
- the tier page in 폭풍 리그 + a bracket shows ▲▼ again (current and previous brackets are now the same cohort).

## Owner actions
1. ~~Custom domain~~ (#5) · ~~GoatCounter~~ · ~~contact@hpgg.win forwarding~~ (done 2026-09-29).
2. First community post (Inven / Arca) with a screenshot; watch day-7 uniques vs day-1 (success criterion in the design doc).

## Next session (owner, 2026-09-29)
1. **Clear the existing issues**: #12 React rebuild of the four legacy pages (with #3 desktop density), #1 light theme, #2 formula presets, #6 Xal'atath assets (when HeroesToolChest ships the data), #9 map detail, #10 i18n groundwork.
2. **Player search (전적검색, #8)** — design first. Heroes Profile Basic allows 25 player calls/week, so a live search needs a plan upgrade or a cached, on-demand design. The home page top is reserved for it (the search banner was removed; no non-working box is shown).
3. **Counters / synergies on the hero page (#15)** → later a ban/pick simulator. `/heroes/matchups` exists (one hero per call, own 700/week bucket). References: lol.ps for the UI, hiosu.gg's simulator (`docs/refs/hiosu-banpick-2026-09-29.png`) for the draft flow — ours speaks in numbers, not per-pair prose.
4. **Region filter (#14)** — 아시아 (KR) / 아메리카 (NA) / 유럽 (EU); decide the Heroes/Stats quota plan first (70/week, 28 used).
5. **Design review with the impeccable skill (#16)** — when there is slack, after #12.
6. **Community (#7)** — design first. The site has no server, database or accounts today; comments/discussion need a backend or a hosted service (e.g. giscus). This changes the "static only" architecture, so decide the shape before coding.

## History
- 2026-09-28: design (office-hours) → collector → repo/Actions/Pages → live data → five pages → table UI → official names + images → 폭풍 리그 naming, brackets, talent builds → lol.ps skin → handoff.
- 2026-09-29: Next.js rebuild (#11) — design system, shell with hero search, new 홈; owner phone review: copy without "체감과 맞는", no voting, brackets 브실골플 / 다마그, hero-detail cleanup, talent popover; Next 16. Full detail in `git log` and `docs/DESIGN-2026-09-28.md` ("UI rebuild and copy decisions").
