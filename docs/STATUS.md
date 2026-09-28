# STATUS — HPGG (hpgg.win)

Start every session here. Operating guide and architecture: `docs/HANDOFF.md`. Backlog: GitHub issues.

## State on 2026-09-28 (core features complete)
- **Live**: https://hpgg.win/hots/ (root `/` forwards here) — 홈 (role leaders, movers vs previous patch, map cards) · 영웅 티어 (QM/SL, SL rank brackets, per-map, ▲▼ vs previous patch, sortable) · 영웅 (grid, search, roles) · 영웅 상세 (tier/rank, other-mode card, per-map win rates, brackets, sticky section tabs, popular talent builds with Korean names and icons) · 전장 (cards → per-map tier table).
- **Pipeline**: daily cron collects 4 stats calls (QM, SL, SL 브실골플, SL 다마그) + 1 builds call, commits to `main`, archives to `snapshots`, deploys Pages. Verified end to end in Actions (test mode and live). Previous patch 2.55.17.97771 backfilled so deltas work from day one.
- **Data/localisation**: official Korean names from game strings; portraits, map previews and talent icons from HeroesToolChest (MIT), attributed in the footer.
- **Design**: Next.js + Tailwind rebuild in progress (branch `feat/next-shell-home`): new design system, header with hero search (초성 too), redesigned 홈; tier/heroes/hero/maps still render their v5 lol.ps-style legacy modules inside the new shell.
- **Quality**: pytest 40 (90 % cov), vitest 43 (95 %), Playwright 25; ruff/mypy/tsc clean. PR gate: `.github/workflows/ci.yml`.
- **Quota**: Heroes/Stats ~30/70 in the rolling week after the two bracket backfills of 2026-09-29 (daily use now 4); builds/all 1/7 per day.

## Brand (2026-09-28, final)
- **hpgg.win — Happy Good Game** (owner purchased; logo + palette by the owner, see `docs/BRAND.md`). Custom domain attached to Pages 2026-09-28 (CNAME shipped from `data/`); HTTPS enforced. Umbrella brand for a multi-game meta site; Heroes of the Storm is the first game and lives under `/hots/`. Repo renamed to `blas1n/hpgg`. Naming history (hotsmeta.kr → hotsmeta.gg → diff.win (not purchasable) → hpgg.win) is in the design doc.

## Owner actions still open
1. ~~Custom domain~~ done (#5).
2. ~~GoatCounter~~ done — https://hpgg.goatcounter.com (page views; voting removed 2026-09-28).
4. **Set up mail forwarding for contact@hpgg.win** (registrar or Cloudflare Email Routing / ImprovMX). The footer already links it; until forwarding exists, mail bounces.
3. First community post (Inven / Arca) with a screenshot; watch day-7 uniques vs day-1 (success criterion in the design doc).

## Next work
UI/UX rebuild in progress (see HANDOFF → "UI/UX work"): next is the tier table in React. Open issues: #1 light theme, #2 formula presets, #3 desktop density, #6 Xal'atath assets, #7 community, #8 player search (quota-constrained), #9 map detail, #10 i18n. Closed: #4 GoatCounter, #5 domain.

## History
- 2026-09-28: design (office-hours) → collector → repo/Actions/Pages → live data → five pages → table UI → official names + images → 폭풍 리그 naming, brackets, talent builds → lol.ps skin → handoff. Full detail in `git log` and `docs/DESIGN-2026-09-28.md` ("As built").
