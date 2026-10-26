# E2E checklist — 무작위 영웅 대전 (ARAM), 2026-10-26

Owner 2026-10-26: the tier table and 전적 검색's 영웅별 통계 get 무작위 영웅 대전 like 빠른 대전 / 폭풍 리그; the tier view is one view of every region (no region split, for the quota); the name is 무작위 영웅 대전 (English pages: ARAM).

## Automated
- [x] Collector: `ar` and `ar` + `groupsize=Solo`, no region, after the 24-call cube; `latest/ar.json` carries the party correction; meta.modes has `ar`, no `ar_*`; not in the weekly history (`tests/test_run.py`)
- [x] A failed ARAM call keeps yesterday's `ar.json` (same patch only) and the run succeeds; a failed solo call publishes no uncorrected ARAM; `--only` skips ARAM
- [x] ARAM is skipped when its 2 calls would leave under 24 Heroes/Stats calls for tomorrow
- [x] Tier table: `#mode-ar` → `?mode=ar`, meta line "무작위 영웅 대전 · … 12,345 매치", no region / bracket / map controls, no ban column, own ranking (`web/e2e/tierlist.spec.ts`)
- [x] `?mode=ar&region=kr&map=…` opens the ARAM view and rewrites to `?mode=ar`
- [x] The mode is offered only once meta.modes.ar exists (`tierModes`, `web/tests/tier.test.ts`)
- [x] 영웅별 통계: a 무작위 영웅 대전 tab; ARAM games counted there only (`web/e2e/players.spec.ts`)

## By hand after the first nightly run
- [ ] `latest/ar.json` on the live site: matches and heroes over the tier floor (50) — if most heroes are grey, the floor or the view needs a second look
- [ ] `hp.quota` for /heroes/stats in the run log: 26 calls a day; `run.aram_skipped` near the end of a window
