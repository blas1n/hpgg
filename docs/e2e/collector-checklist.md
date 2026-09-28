# E2E checklist — collector (non-web; run by a human or by Claude)

Preconditions: `HP_API_TOKEN` in `~/Works/hotsmeta/.env`. Test Data mode costs no quota; Live Data items are marked.

## Test Data mode (verified 2026-09-28)
- [x] `uv run python -m collector` exits 0 (5 calls, 60 s apart → about 5 min) — run 2: EXIT=0 in 5 min 06 s; the first call got a 429 and succeeded after the 60 s `Retry-After` wait
- [x] `data/latest/{qm,sl,sl_low,sl_mid,sl_high,meta}.json` exist and `meta.json.current_patch` equals the newest `valid_globals` build from `/v1/patches` — 2.55.17.97771 (test-mode list)
- [x] `data/.snapshot_out/<today>/` holds 5 `raw_*.json.gz` + 5 normalised gz + meta.json — 11 files
- [x] No token string in the JSON log — grep count 0 (httpx request lines are lowered to WARNING so URLs are not echoed)
- [ ] A second run keeps `patch_started_at` from the first run (same patch) — covered by the unit test `test_build_meta_first_run_and_patch_change`; confirm on the first two cron days in Actions
- [x] A bad token (`HP_API_TOKEN=bad uv run python -m collector`) exits 1 and leaves `data/latest/` untouched — `401 unauthenticated`, no files written, token absent from the log
- [x] Test data is five heroes with `wins` only and **`group_by_map` is ignored (flat payload)** → `normalize.flat_payload` warned 5 times, five `map: "all"` rows stored, no crash

## Live Data mode
- [x] Real `group_by_map=true` shape recorded from one probe call (1 of 70/week): `{map: {average_*, data: [rows]}}`, rows = `wins, losses, games_played, win_rate, ban_rate, win_rate_change, popularity, pick_rate, influence, confidence_interval, total_filter_type` (no `bans` count → derived from `ban_rate`). Fixture `tests/fixtures/live_probe_qm_2.55.17.98025.json.gz`, unit test `test_live_probe_fixture_normalizes_per_map`
- [x] A cold query answers 202 and the poll loop finishes with 200 — probe: `hp.job_started` → 2 polls → `hp.job_done` in 24 s
- [ ] First full live run (dispatch or cron): all five files carry per-map rows and `meta.modes.*.heroes_over_200` is non-zero
- [ ] `qm.json` `map: "all"` row for Illidan has a `win_rate` within ±0.1 of the Heroes Profile web page (Global/Hero, QM, newest minor patch)
- [ ] `sl_high.json` (league_tier 5,6) has fewer matches than `sl.json`
